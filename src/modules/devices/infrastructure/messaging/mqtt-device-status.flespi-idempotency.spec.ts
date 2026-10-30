// Unit-level guard: PostgreSQL concurrency and RLS validated separately by SQL035.
jest.mock('./mqtt-runtime.service', () => ({ MqttRuntimeService: class {} }));
jest.mock('../../../../infrastructure/database/prisma/prisma-iot.service', () => ({ PrismaIotService: class {} }));
jest.mock('../../../../infrastructure/database/prisma/prisma-rls.service', () => ({ PrismaRlsService: class {} }));
jest.mock('../../../realtime/realtime-events.service', () => ({ RealtimeEventsService: class {} }));

import { Logger } from '@nestjs/common';
import { MqttDeviceStatusSubscriber } from './mqtt-device-status.subscriber';

const topic = 'smarthome/dev/v1/devices/shelly1pmg4-d885acf06990/events/rpc';
const direct = 'smarthome/dev/v1/devices/shelly1pmg4-d885acf06990/status/switch:0';
const rpc = Buffer.from(JSON.stringify({
  src: 'shelly1pmg4-d885acf06990', method: 'NotifyStatus',
  params: { ts: 1793388600.5, 'switch:0': { output: true, apower: 25 } },
}));

function setup(duplicate: boolean) {
  const emitToUser = jest.fn();
  const updated = {
    id_device: 'device-1', id_home: 'home-1', connectivity_status: 'ONLINE',
    is_on: true, current_power_w: 25, updated_at: new Date('2026-10-30T22:00:00Z'),
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(duplicate ? [] : [{ id_device: 'device-1' }]),
    device: { update: jest.fn().mockResolvedValue(updated) },
    consumption: {
      findFirst: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    device: {
      findFirst: jest.fn().mockResolvedValue({
        id_device: 'device-1', id_home: 'home-1', name: 'Luz',
        manufacturer_device_id: 'shelly1pmg4-d885acf06990',
      }),
      update: jest.fn(),
    },
    $transaction: jest.fn((callback: (tx: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const subscriber = new MqttDeviceStatusSubscriber(
    { config: { flespiDeviceId: 'shelly1pmg4-d885acf06990', switchId: 0 } } as never,
    prisma as never, {} as never, { emitToUser } as never,
  );
  const internal = subscriber as unknown as {
    extractManufacturerDeviceId: (t: string) => string | null;
    parsePayload: (t: string, buf: Buffer) => unknown;
    findHomeRealtimeRecipients: (tx: unknown, id: string, home: string) => Promise<{id_user: string}[]>;
    handleStatusMessage: (t: string, buf: Buffer) => Promise<void>;
  };
  jest.spyOn(internal, 'extractManufacturerDeviceId').mockReturnValue('shelly1pmg4-d885acf06990');
  jest.spyOn(internal, 'parsePayload').mockReturnValue({
    connectivityStatus: 'ONLINE', isOn: true, currentPowerW: 25,
    energyTotalKwh: 1.25, readAt: '2026-10-30T22:00:00Z',
  });
  jest.spyOn(internal, 'findHomeRealtimeRecipients').mockResolvedValue([{ id_user: 'user-1' }]);
  jest.spyOn(Logger.prototype, 'log').mockImplementation();
  jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  jest.spyOn(Logger.prototype, 'error').mockImplementation();
  return { internal, tx, prisma, emitToUser };
}

describe('flespi: SQL035 ledger y consumo en una transacción', () => {
  afterEach(() => jest.restoreAllMocks());

  it('inserta ledger antes de estado y consumo y notifica después de confirmar', async () => {
    const c = setup(false);
    await c.internal.handleStatusMessage(topic, rpc);
    expect(c.prisma.device.update).not.toHaveBeenCalled();
    expect(c.tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(c.tx.consumption.findFirst).not.toHaveBeenCalled();
    expect(c.tx.device.update).toHaveBeenCalledTimes(1);
    expect(c.tx.consumption.createMany).toHaveBeenCalledTimes(1);
    expect(c.emitToUser).toHaveBeenCalledWith('user-1', 'consumption.created', expect.anything());
    const insertOrder = c.tx.$queryRaw.mock.invocationCallOrder[0];
    const deviceOrder = c.tx.device.update.mock.invocationCallOrder[0];
    expect(insertOrder).toBeLessThan(deviceOrder);
  });

  it('no actualiza estado, consumo ni realtime al detectar duplicado', async () => {
    const c = setup(true);
    await c.internal.handleStatusMessage(topic, rpc);
    expect(c.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(c.tx.device.update).not.toHaveBeenCalled();
    expect(c.tx.consumption.createMany).not.toHaveBeenCalled();
    expect(c.emitToUser).not.toHaveBeenCalled();
  });

  it('sin timestamp de origen actualiza estado, pero no almacena consumo', async () => {
    const c = setup(false);
    const noTs = Buffer.from(JSON.stringify({
      method: 'NotifyStatus', params: { 'switch:0': { output: true, apower: 25 } },
    }));
    await c.internal.handleStatusMessage(topic, noTs);
    expect(c.tx.$queryRaw).not.toHaveBeenCalled();
    expect(c.tx.device.update).toHaveBeenCalledTimes(1);
    expect(c.tx.consumption.createMany).not.toHaveBeenCalled();
    expect(c.emitToUser).toHaveBeenCalledWith('user-1', 'device.status.updated', expect.anything());
  });

  it('status/switch:0 no inventa una identidad por hora de recepción', async () => {
    const c = setup(false);
    await c.internal.handleStatusMessage(direct, Buffer.from(JSON.stringify({ output: true, apower: 25 })));
    expect(c.tx.$queryRaw).not.toHaveBeenCalled();
    expect(c.tx.consumption.createMany).not.toHaveBeenCalled();
    expect(c.tx.device.update).toHaveBeenCalledTimes(1);
  });
});
