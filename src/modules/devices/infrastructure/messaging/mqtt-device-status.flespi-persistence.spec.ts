// Unit tests for transaction boundaries, not an integration test with PostgreSQL.
jest.mock('./mqtt-runtime.service', () => ({ MqttRuntimeService: class {} }));
jest.mock('../../../../infrastructure/database/prisma/prisma-iot.service', () => ({
  PrismaIotService: class {},
}));
jest.mock('../../../../infrastructure/database/prisma/prisma-rls.service', () => ({
  PrismaRlsService: class {},
}));
jest.mock('../../../realtime/realtime-events.service', () => ({
  RealtimeEventsService: class {},
}));

import { Logger } from '@nestjs/common';
import { MqttDeviceStatusSubscriber } from './mqtt-device-status.subscriber';

const receivedAt = '2026-10-30T19:30:00.000Z';

function setup(consumeFailure = false, power?: number) {
  const emitToUser = jest.fn();
  const updated = {
    id_device: 'device-1', id_home: 'home-1', connectivity_status: 'ONLINE',
    is_on: false, current_power_w: power ?? 0,
    updated_at: new Date(receivedAt),
  };
  const tx = {
    device: { update: jest.fn().mockResolvedValue(updated) },
    $queryRaw: jest.fn().mockImplementation(async (sql: TemplateStringsArray) => {
      const statement = sql.join('?');
      if (/FOR UPDATE/.test(statement)) return [{ id_device: 'device-1' }];
      if (/SELECT device_event_ts/.test(statement)) return [];
      if (/INSERT INTO consumption\.mqtt_ingest_dedup/.test(statement))
        return [{ id_device: 'device-1' }];
      if (/SELECT energy_total_kwh/.test(statement)) return [{ energy_total_kwh: 1.5 }];
      throw new Error(`Unexpected SQL in test: ${statement}`);
    }),
    consumption: {
      findFirst: jest.fn().mockResolvedValue({ energy_total_kwh: 1.5 }),
      createMany: jest.fn().mockImplementation(() => consumeFailure
        ? Promise.reject(new Error('SIMULATED_CONSUMPTION_FAILURE'))
        : Promise.resolve({ count: 1 })),
    },
  };
  const prisma = {
    device: {
      findFirst: jest.fn().mockResolvedValue({
        id_device: 'device-1', id_home: 'home-1', name: 'Shelly',
        manufacturer_device_id: 'shelly1pmg4-d885acf06990',
      }),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (cb: (transaction: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const subscriber = new MqttDeviceStatusSubscriber(
    { config: { flespiDeviceId: 'shelly1pmg4-d885acf06990', switchId: 0 } } as never,
    prisma as never,
    {} as never,
    { emitToUser } as never,
  );
  const privateSubscriber = subscriber as unknown as {
    extractManufacturerDeviceId: (topic: string) => string | null;
    parsePayload: (topic: string, payload: Buffer) => unknown;
    findHomeRealtimeRecipients: (
      tx: unknown, deviceId: string, homeId: string,
    ) => Promise<{ id_user: string }[]>;
    handleStatusMessage: (topic: string, payload: Buffer) => Promise<void>;
  };
  jest.spyOn(privateSubscriber, 'extractManufacturerDeviceId')
    .mockReturnValue('shelly1pmg4-d885acf06990');
  jest.spyOn(privateSubscriber, 'parsePayload').mockReturnValue({
    connectivityStatus: 'ONLINE', isOn: false,
    ...(power === undefined ? {} : { currentPowerW: power }),
    energyTotalKwh: 1.5, readAt: receivedAt,
  });
  jest.spyOn(privateSubscriber, 'findHomeRealtimeRecipients')
    .mockResolvedValue([{ id_user: 'user-1' }]);
  jest.spyOn(Logger.prototype, 'error').mockImplementation();
  jest.spyOn(Logger.prototype, 'log').mockImplementation();
  return { subscriber: privateSubscriber, prisma, tx, emitToUser };
}

const rpcTopic = 'smarthome/dev/v1/devices/shelly1pmg4-d885acf06990/events/rpc';
const rpcPayload = Buffer.from(JSON.stringify({
  src: 'shelly1pmg4-d885acf06990',
  method: 'NotifyStatus',
  params: { ts: 1793388600.25, 'switch:0': { output: false, apower: 15 } },
}));

describe('flespi: persistencia atómica de estado y consumo', () => {
  afterEach(() => jest.restoreAllMocks());

  it('escribe estado y consumo desde la misma transacción', async () => {
    const ctx = setup(false, 15);
    await ctx.subscriber.handleStatusMessage(rpcTopic, rpcPayload);

    expect(ctx.prisma.device.update).not.toHaveBeenCalled();
    expect(ctx.tx.device.update).toHaveBeenCalledTimes(1);
    expect(ctx.tx.consumption.createMany).toHaveBeenCalledTimes(1);
    expect(ctx.tx.consumption.findFirst).not.toHaveBeenCalled();
    expect(ctx.tx.$queryRaw).toHaveBeenCalledTimes(4);
    // Lock + SQL036 check precede SQL035 insert; last read uses permitted columns.
    const lockSql = (ctx.tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(lockSql).toMatch(/FOR UPDATE/);
    const previousSql = (ctx.tx.$queryRaw.mock.calls[3][0] as TemplateStringsArray).join('?');
    expect(previousSql).toMatch(/SELECT energy_total_kwh\s+FROM consumption\.consumption/);
    expect(previousSql).not.toMatch(/SELECT\s+\*/i);
    expect(ctx.tx.consumption.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ energy_delta_kwh: 0, power_w: 15 })],
    }));
    expect(ctx.emitToUser).toHaveBeenCalledWith(
      'user-1', 'device.status.updated', expect.objectContaining({ isOn: false }),
    );
    expect(ctx.emitToUser).toHaveBeenCalledWith(
      'user-1', 'consumption.created', expect.objectContaining({ powerW: 15 }),
    );
  });

  it('calcula el delta con la lectura SQL limitada al rol ingest', async () => {
    const ctx = setup(false, 15);
    const queryRaw = ctx.tx.$queryRaw.getMockImplementation()!;
    ctx.tx.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => {
      if (/SELECT energy_total_kwh/.test(sql.join('?')))
        return [{ energy_total_kwh: 1 }];
      return queryRaw(sql);
    });
    await ctx.subscriber.handleStatusMessage(rpcTopic, rpcPayload);
    expect(ctx.tx.consumption.findFirst).not.toHaveBeenCalled();
    expect(ctx.tx.consumption.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ energy_delta_kwh: 0.5, power_w: 15 })],
    }));
  });

  it('si falla el consumo no emite estado ni consumo', async () => {
    const ctx = setup(true, 15);
    await expect(ctx.subscriber.handleStatusMessage(rpcTopic, rpcPayload))
      .rejects.toThrow('SIMULATED_CONSUMPTION_FAILURE');
    expect(ctx.prisma.device.update).not.toHaveBeenCalled();
    expect(ctx.tx.device.update).toHaveBeenCalledTimes(1);
    expect(ctx.tx.consumption.createMany).toHaveBeenCalledTimes(1);
    expect(ctx.emitToUser).not.toHaveBeenCalled();
  });

  it('NotifyStatus sin potencia actualiza solo el estado sin crear consumo', async () => {
    const ctx = setup(false);
    await ctx.subscriber.handleStatusMessage(rpcTopic, rpcPayload);
    expect(ctx.tx.device.update).toHaveBeenCalledTimes(1);
    const updateArgs = ctx.tx.device.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(Object.prototype.hasOwnProperty.call(updateArgs.data, 'current_power_w')).toBe(false);
    expect(ctx.tx.consumption.createMany).not.toHaveBeenCalled();
    expect(ctx.emitToUser).toHaveBeenCalledWith(
      'user-1', 'device.status.updated', expect.anything(),
    );
    expect(ctx.emitToUser).not.toHaveBeenCalledWith(
      'user-1', 'consumption.created', expect.anything(),
    );
  });
});
