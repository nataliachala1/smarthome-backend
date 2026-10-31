jest.mock('./mqtt-runtime.service', () => ({ MqttRuntimeService: class {} }));
jest.mock('./flespi-shelly-state.reconciler', () => ({ FlespiShellyStateReconciler: class {} }));

import { Logger } from '@nestjs/common';
import { FlespiShellyStateSyncWorker } from './flespi-shelly-state-sync.worker';

const DEVICE = 'shelly1pmg4-d885acf06990';
const SOURCE = `smarthome/dev/v1/backend/${DEVICE}`;
const originalInterval = process.env.SHELLY_FLESPI_STATE_SYNC_INTERVAL_SECONDS;
const originalSingleReplica = process.env.SHELLY_FLESPI_STATE_SYNC_SINGLE_REPLICA;

function setup(configOverrides: Record<string, unknown> = {}) {
  const reconcile = jest.fn().mockResolvedValue('unchanged');
  const mqtt = { config: {
    brokerUrl: 'mqtts://mqtt.flespi.io:8883', tls: true,
    flespiDeviceId: DEVICE, namespace: 'smarthome/dev/v1', rpcSource: SOURCE,
    ...configOverrides,
  } };
  const worker = new FlespiShellyStateSyncWorker(mqtt as never, { reconcile } as never);
  return { worker, reconcile };
}

describe('3D.6-D: Shelly DEV state sync worker opt-in', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-30T20:00:00Z'));
    process.env.SHELLY_FLESPI_STATE_SYNC_SINGLE_REPLICA = 'true';
    delete process.env.SHELLY_FLESPI_STATE_SYNC_INTERVAL_SECONDS;
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => {
    if (originalSingleReplica === undefined) delete process.env.SHELLY_FLESPI_STATE_SYNC_SINGLE_REPLICA;
    else process.env.SHELLY_FLESPI_STATE_SYNC_SINGLE_REPLICA = originalSingleReplica;
    if (originalInterval === undefined) delete process.env.SHELLY_FLESPI_STATE_SYNC_INTERVAL_SECONDS;
    else process.env.SHELLY_FLESPI_STATE_SYNC_INTERVAL_SECONDS = originalInterval;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('runs immediately and then at a bounded 30-second interval', async () => {
    const c = setup();
    c.worker.onModuleInit();
    await Promise.resolve();
    expect(c.reconcile).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(c.reconcile).toHaveBeenCalledTimes(2);
    c.worker.onModuleDestroy();
  });

  it('does not overlap an in-flight reconciliation', async () => {
    const c = setup();
    let release!: (value: string) => void;
    c.reconcile.mockReturnValue(new Promise(resolve => { release = resolve; }));
    c.worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(c.reconcile).toHaveBeenCalledTimes(1);
    release('updated');
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(c.reconcile).toHaveBeenCalledTimes(2);
    c.worker.onModuleDestroy();
  });

  it('uses backoff after a failed RPC and does not leak errors', async () => {
    const c = setup();
    c.reconcile.mockRejectedValueOnce(new Error('synthetic-private-token'));
    c.worker.onModuleInit();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(c.reconcile).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.warn).toHaveBeenCalledWith('SHELLY_STATE_RECONCILE_RETRY_SCHEDULED');
    c.worker.onModuleDestroy();
  });

  it('stops scheduling after shutdown', async () => {
    const c = setup();
    c.worker.onModuleInit();
    await Promise.resolve();
    c.worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(180_000);
    expect(c.reconcile).toHaveBeenCalledTimes(1);
  });

  it('fails closed for an unscoped source or missing single-replica guard', () => {
    const badSource = setup({ rpcSource: 'smarthome/dev/v1/backend' });
    expect(() => badSource.worker.onModuleInit()).toThrow('SHELLY_FLESPI_STATE_SYNC_CONFIGURATION_INVALID');
    process.env.SHELLY_FLESPI_STATE_SYNC_SINGLE_REPLICA = 'false';
    expect(() => setup().worker.onModuleInit()).toThrow('SHELLY_FLESPI_STATE_SYNC_CONFIGURATION_INVALID');
  });

  it.each(['0', '-10', '14', '301', 'abc', '1.5'])('rejects an invalid poll interval (%s)', value => {
    process.env.SHELLY_FLESPI_STATE_SYNC_INTERVAL_SECONDS = value;
    expect(() => setup()).toThrow('SHELLY_FLESPI_STATE_SYNC_INTERVAL_SECONDS_INVALID');
  });
});
