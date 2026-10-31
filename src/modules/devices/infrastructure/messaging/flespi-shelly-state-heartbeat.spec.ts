// Covers the reachable-Shelly heartbeat refresh without writing consumption.
jest.mock('./mqtt-runtime.service', () => ({ MqttRuntimeService: class {} }));
jest.mock('./flespi-shelly-status-rpc.client', () => ({ FlespiShellyStatusRpcClient: class {} }));
jest.mock('../../../../infrastructure/database/prisma/prisma-iot.service', () => ({ PrismaIotService: class {} }));
jest.mock('../../../realtime/realtime-events.service', () => ({ RealtimeEventsService: class {} }));

import { FlespiShellyStateReconciler } from './flespi-shelly-state.reconciler';

const ID = 'shelly1pmg4-d885acf06990';

function setup(lastSeen: Date) {
  const now = new Date('2026-10-30T23:00:00Z');
  const state = {
    id_device: 'device-1', id_home: 'home-1',
    is_on: true, connectivity_status: 'ONLINE',
    updated_at: new Date('2026-10-30T22:58:00Z'),
    last_seen_at: lastSeen,
  };
  const update = jest.fn().mockResolvedValue({ ...state, updated_at: now });
  const tx = {
    device: { findFirst: jest.fn().mockResolvedValue(state), update },
    $queryRaw: jest.fn().mockImplementation(async (sql: TemplateStringsArray) => {
      const statement = sql.join('?');
      if (/FOR UPDATE/.test(statement)) return [{ id_device: state.id_device }];
      if (/SELECT device_event_ts/.test(statement)) return [{ device_event_ts: '1793388600.5' }];
      throw new Error(`Unexpected SQL: ${statement}`);
    }),
  };
  const getSwitchStatus = jest.fn().mockResolvedValue({ output: true, receivedAt: now });
  const emitToUser = jest.fn();
  const prisma = {
    device: { findFirst: jest.fn().mockResolvedValue({ id_device: state.id_device, id_home: state.id_home }) },
    $transaction: jest.fn(async (cb: (arg: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const reconciler = new FlespiShellyStateReconciler(
    { config: { flespiDeviceId: ID, brokerUrl: 'mqtts://mqtt.flespi.io:8883' } } as never,
    { getSwitchStatus } as never, prisma as never, { emitToUser } as never,
  );
  return { reconciler, tx, update, emitToUser };
}

describe('3D.6-D: update reachability without false telemetry', () => {
  it('refreshes an old last_seen_at without changing power or energy', async () => {
    const c = setup(new Date('2026-10-30T22:58:00Z'));
    expect(await c.reconciler.reconcile()).toBe('unchanged');
    expect(c.update).toHaveBeenCalledWith({
      where: { id_device: 'device-1' },
      data: { last_seen_at: new Date('2026-10-30T23:00:00Z') },
    });
    expect(c.emitToUser).not.toHaveBeenCalled();
    expect(c.tx.$queryRaw.mock.calls.map(call => (call[0] as TemplateStringsArray).join('?')).join('\n'))
      .not.toMatch(/INSERT INTO|DELETE FROM|consumption\.consumption/);
  });

  it('does not update the row on every poll if its heartbeat is recent', async () => {
    const c = setup(new Date('2026-10-30T22:59:50Z'));
    expect(await c.reconciler.reconcile()).toBe('unchanged');
    expect(c.update).not.toHaveBeenCalled();
  });

  it('never moves last_seen_at backwards if telemetry has newer time', async () => {
    const c = setup(new Date('2026-10-30T23:00:05Z'));
    expect(await c.reconciler.reconcile()).toBe('unchanged');
    expect(c.update).not.toHaveBeenCalled();
  });
});
