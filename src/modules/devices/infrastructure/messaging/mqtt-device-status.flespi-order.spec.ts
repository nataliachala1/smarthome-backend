// SQL036: unit guards for state freshness. Real concurrency requires PostgreSQL integration.
jest.mock('./mqtt-runtime.service', () => ({ MqttRuntimeService: class {} }));
jest.mock('../../../../infrastructure/database/prisma/prisma-iot.service', () => ({ PrismaIotService: class {} }));
jest.mock('../../../../infrastructure/database/prisma/prisma-rls.service', () => ({ PrismaRlsService: class {} }));
jest.mock('../../../realtime/realtime-events.service', () => ({ RealtimeEventsService: class {} }));

import { MqttDeviceStatusSubscriber } from './mqtt-device-status.subscriber';

const topic = 'smarthome/dev/v1/devices/shelly1pmg4-d885acf06990/events/rpc';
const frame = (ts: number, power?: number) => Buffer.from(JSON.stringify({
  method: 'NotifyStatus', params: {
    ts, 'switch:0': { output: true, ...(power === undefined ? {} : { apower: power }) },
  },
}));

function setup(newer: boolean) {
  const emitToUser = jest.fn();
  const tx = {
    $queryRaw: jest.fn().mockImplementation((sql: TemplateStringsArray) => {
      const statement = sql.join('?');
      if (/FOR UPDATE/.test(statement)) return Promise.resolve([{ id_device: 'dev-1' }]);
      if (/SELECT device_event_ts/.test(statement))
        return Promise.resolve(newer ? [{ device_event_ts: 1793388602 }] : []);
      if (/INSERT INTO consumption\.mqtt_ingest_dedup/.test(statement))
        return Promise.resolve([{ id_device: 'dev-1' }]);
      if (/SELECT energy_total_kwh/.test(statement)) return Promise.resolve([]);
      throw new Error(`Unexpected SQL: ${statement}`);
    }),
    device: { update: jest.fn().mockResolvedValue({
      id_device: 'dev-1', id_home: 'home-1', connectivity_status: 'ONLINE',
      is_on: true, current_power_w: 25, updated_at: new Date(),
    }) },
    consumption: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    device: { findFirst: jest.fn().mockResolvedValue({
      id_device: 'dev-1', id_home: 'home-1', name: 'Shelly',
      manufacturer_device_id: 'shelly1pmg4-d885acf06990',
    }) },
    $transaction: jest.fn((cb: (arg: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const subscriber = new MqttDeviceStatusSubscriber(
    { config: { flespiDeviceId: 'shelly1pmg4-d885acf06990', switchId: 0 } } as never,
    prisma as never, {} as never, { emitToUser } as never,
  ) as unknown as { handleStatusMessage(t: string, p: Buffer): Promise<void>; extractManufacturerDeviceId(t: string): string | null; parsePayload(t: string, p: Buffer): unknown; findHomeRealtimeRecipients(tx: unknown, deviceId: string, homeId: string): Promise<{id_user: string}[]> };
  jest.spyOn(subscriber, 'extractManufacturerDeviceId').mockReturnValue('shelly1pmg4-d885acf06990');
  jest.spyOn(subscriber, 'parsePayload').mockReturnValue({
    connectivityStatus: 'ONLINE', isOn: true, currentPowerW: 25,
    energyTotalKwh: 1.5, readAt: '2026-10-30T22:00:00Z',
  });
  jest.spyOn(subscriber, 'findHomeRealtimeRecipients').mockResolvedValue([{id_user: 'user-1'}]);
  return { subscriber, tx, emitToUser };
}

describe('flespi SQL036: orden temporal', () => {
  afterEach(() => jest.restoreAllMocks());

  it('evento atrasado se descarta antes de escribir estado o energia', async () => {
    const c = setup(true);
    await c.subscriber.handleStatusMessage(topic, frame(1793388600.5, 25));
    expect(c.tx.$queryRaw).toHaveBeenCalledTimes(2); // lock + watermark
    expect(c.tx.device.update).not.toHaveBeenCalled();
    expect(c.tx.consumption.createMany).not.toHaveBeenCalled();
    expect(c.emitToUser).not.toHaveBeenCalled();
  });

  it('evento posterior se escribe tras bloquear y consultar SQL036', async () => {
    const c = setup(false);
    await c.subscriber.handleStatusMessage(topic, frame(1793388603.5, 25));
    expect(c.tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(c.tx.device.update).toHaveBeenCalledTimes(1);
    expect(c.tx.consumption.createMany).toHaveBeenCalledTimes(1);
    expect(c.emitToUser).toHaveBeenCalledWith('user-1', 'device.status.updated', expect.anything());
  });

  it('RPC con origen pero sin potencia registra watermark sin crear consumo', async () => {
    const c = setup(false);
    jest.spyOn(c.subscriber, 'parsePayload').mockReturnValue({
      connectivityStatus: 'ONLINE', isOn: true,
      readAt: '2026-10-30T22:00:00Z',
    });
    await c.subscriber.handleStatusMessage(topic, frame(1793388603.5));
    expect(c.tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(c.tx.device.update).toHaveBeenCalledTimes(1);
    expect(c.tx.consumption.createMany).not.toHaveBeenCalled();
    expect(c.emitToUser).not.toHaveBeenCalledWith('user-1', 'consumption.created', expect.anything());
  });
});
