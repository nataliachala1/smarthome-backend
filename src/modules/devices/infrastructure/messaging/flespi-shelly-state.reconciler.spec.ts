// Unit tests for concurrency decisions. A real PostgreSQL integration is still required.
jest.mock('./mqtt-runtime.service', () => ({ MqttRuntimeService: class {} }));
jest.mock('./flespi-shelly-status-rpc.client', () => ({ FlespiShellyStatusRpcClient: class {} }));
jest.mock('../../../../infrastructure/database/prisma/prisma-iot.service', () => ({ PrismaIotService: class {} }));
jest.mock('../../../realtime/realtime-events.service', () => ({ RealtimeEventsService: class {} }));

import { FlespiShellyStateReconciler } from './flespi-shelly-state.reconciler';

const DEVICE = 'shelly1pmg4-d885acf06990';
const DATE = new Date('2026-10-30T22:00:00Z');
const REPLY = new Date('2026-10-30T22:00:01Z');

type FakeState = {
  id_device: string;
  id_home: string;
  is_on: boolean;
  connectivity_status: 'ONLINE' | 'OFFLINE';
  updated_at: Date;
  last_seen_at: Date | null;
};

function setup(options: { enabled?: boolean; found?: boolean; initiallyOn?: boolean } = {}) {
  let state: FakeState = {
    id_device: 'device-1', id_home: 'home-1',
    is_on: options.initiallyOn ?? false,
    connectivity_status: 'ONLINE', updated_at: DATE,
    last_seen_at: DATE,
  };
  let watermark = '1793388600.50';
  const emitToUser = jest.fn();
  const getSwitchStatus = jest.fn().mockResolvedValue({ output: true, receivedAt: REPLY, powerW: 98.5 });
  const findFirst = jest.fn().mockImplementation(() => Promise.resolve(
    options.found === false ? null : { ...state }));
  const update = jest.fn().mockImplementation(({ data }: { data: Partial<FakeState> }) => {
    state = { ...state, ...data, updated_at: REPLY };
    return Promise.resolve({ ...state, current_power_w: 50 });
  });
  const tx = {
    device: { findFirst, update },
    $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (/FOR UPDATE/.test(sql)) return Promise.resolve(options.found === false ? [] : [{ id_device: 'device-1' }]);
      if (/SELECT device_event_ts/.test(sql)) return Promise.resolve([{ device_event_ts: watermark }]);
      if (/fn_mqtt_realtime_recipients/.test(sql)) return Promise.resolve([{ id_user: 'user-1' }]);
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  };
  const prisma = {
    device: { findFirst: jest.fn().mockResolvedValue(
      options.found === false ? null : { id_device: 'device-1', id_home: 'home-1' },
    ) },
    $transaction: jest.fn((cb: (trx: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const mqtt = { config: {
    flespiDeviceId: options.enabled === false ? undefined : DEVICE,
    brokerUrl: 'mqtts://mqtt.flespi.io:8883',
  } };
  const reconciler = new FlespiShellyStateReconciler(
    mqtt as never, { getSwitchStatus } as never,
    prisma as never, { emitToUser } as never,
  );
  return {
    reconciler, tx, prisma, emitToUser, getSwitchStatus,
    setWatermark: (newValue: string) => { watermark = newValue; },
    setState: (changes: Partial<FakeState>) => { state = { ...state, ...changes }; },
  };
}

describe('3D.6-B: reconciliacion segura de estado Shelly', () => {
  afterEach(() => jest.restoreAllMocks());

  it('actualiza is_on y emite realtime solo después del commit, sin consumo', async () => {
    const c = setup();
    expect(await c.reconciler.reconcile()).toBe('updated');
    expect(c.getSwitchStatus).toHaveBeenCalledTimes(1);
    expect(c.tx.device.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { is_on: true, connectivity_status: 'ONLINE', last_seen_at: REPLY },
    }));
    expect(c.emitToUser).toHaveBeenCalledWith('user-1', 'device.status.updated', expect.objectContaining({
      isOn: true, currentPowerW: 50,
    }));
    expect((c.tx.$queryRaw.mock.calls as Array<[TemplateStringsArray]>).map(([sql]) => sql.join('?')).join('\n'))
      .not.toMatch(/INSERT INTO|consumption\.consumption/);
  });

  it('omite un RPC atrasado cuando avanzó SQL036 durante el vuelo', async () => {
    const c = setup();
    c.getSwitchStatus.mockImplementation(() => {
      c.setWatermark('1793388601.00');
      return Promise.resolve({ output: true, receivedAt: REPLY });
    });
    expect(await c.reconciler.reconcile()).toBe('stale');
    expect(c.tx.device.update).not.toHaveBeenCalled();
    expect(c.emitToUser).not.toHaveBeenCalled();
  });

  it('omite un RPC atrasado cuando otra transaccion cambió el estado', async () => {
    const c = setup();
    c.getSwitchStatus.mockImplementation(() => {
      c.setState({ updated_at: new Date('2026-10-30T22:00:00.500Z') });
      return Promise.resolve({ output: true, receivedAt: REPLY });
    });
    expect(await c.reconciler.reconcile()).toBe('stale');
    expect(c.tx.device.update).not.toHaveBeenCalled();
  });

  it('no escribe ni emite si el resultado coincide y el dispositivo está online', async () => {
    const c = setup({ initiallyOn: true });
    expect(await c.reconciler.reconcile()).toBe('unchanged');
    expect(c.tx.device.update).not.toHaveBeenCalled();
    expect(c.emitToUser).not.toHaveBeenCalled();
  });

  it('no usa la red si flespi no está configurado', async () => {
    const c = setup({ enabled: false });
    expect(await c.reconciler.reconcile()).toBe('disabled');
    expect(c.getSwitchStatus).not.toHaveBeenCalled();
  });

  it('no usa la red si no hay dispositivo activo', async () => {
    const c = setup({ found: false });
    expect(await c.reconciler.reconcile()).toBe('not_found');
    expect(c.getSwitchStatus).not.toHaveBeenCalled();
  });

  it('un error RPC no provoca escritura, notificacion ni lectura falsa', async () => {
    const c = setup();
    c.getSwitchStatus.mockRejectedValue(new Error('MQTT_FLESPI_RPC_TIMEOUT'));
    await expect(c.reconciler.reconcile()).rejects.toThrow('MQTT_FLESPI_RPC_TIMEOUT');
    expect(c.tx.device.update).not.toHaveBeenCalled();
    expect(c.emitToUser).not.toHaveBeenCalled();
  });

  it('agrupa llamadas simultaneas para no enviar varios RPC', async () => {
    const c = setup();
    let release!: (value: { output: boolean; receivedAt: Date }) => void;
    c.getSwitchStatus.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const first = c.reconciler.reconcile();
    const second = c.reconciler.reconcile();
    expect(first).toBe(second);
    // Allow the initial short DB transaction to complete and enter RPC.
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
    expect(release).toBeDefined();
    release({ output: true, receivedAt: REPLY });
    expect(await first).toBe('updated');
    expect(c.getSwitchStatus).toHaveBeenCalledTimes(1);
  });
});
