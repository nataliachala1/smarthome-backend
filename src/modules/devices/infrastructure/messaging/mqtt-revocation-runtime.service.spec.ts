import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { MqttRuntimeService } from './mqtt-runtime.service';
import {
  MqttRevocationResources,
  MqttRevocationRuntimeService,
} from './mqtt-revocation-runtime.service';

// Unit tests inject settings directly; the E2E suite uses Nest ConfigService.
jest.mock('@nestjs/config', () => ({
  ConfigService: class {
    constructor(private readonly values: Record<string, unknown>) {}
    get(key: string) {
      return this.values[key];
    }
  },
}));

describe('revocation runtime lifecycle', () => {
  const environment = () => ({
    NODE_ENV: 'test',
    MQTT_REVOCATION_ENABLED: 'true',
    DATABASE_URL: 'postgresql://app:fixture@db.test/smarthome',
    DATABASE_IOT_URL: 'postgresql://ingest:fixture@db.test/smarthome',
    DATABASE_MQTT_REVOKE_URL: 'postgresql://revoker:fixture@db.test/smarthome',
    MQTT_BROKER_URL: 'mqtts://broker.test',
    MQTT_TOPIC_NAMESPACE: 'test/v1',
    MQTT_USERNAME: 'service',
    MQTT_PASSWORD: 'fixture',
    MQTT_ADMIN_USERNAME: 'admin',
    MQTT_ADMIN_PASSWORD: 'admin-fixture',
    MQTT_ADMIN_CLIENT_ID: 'worker-1',
  });
  const safe = { rows: Array.from({ length: 8 }, () => ({ passed: true })) };
  function fixture(overrides: Record<string, string> = {}) {
    const config = new ConfigService({ ...environment(), ...overrides });
    const query = jest
      .fn<Promise<{ rows: unknown[] }>, [string]>()
      .mockResolvedValue(safe);
    const end = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    const pool = { query, end, on: jest.fn() } as unknown as Pool;
    const resources = new MqttRevocationResources();
    const createPool = jest.spyOn(resources, 'pool').mockReturnValue(pool);
    const createBroker = jest.spyOn(resources, 'broker');
    const runtime = new MqttRevocationRuntimeService(
      config,
      new MqttRuntimeService(config),
      resources,
    );
    return { runtime, query, end, createPool, createBroker };
  }
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('opens no database or broker resource while disabled', async () => {
    const f = fixture({
      MQTT_REVOCATION_ENABLED: 'false',
      DATABASE_MQTT_REVOKE_CA_FILE: 'absent.pem',
    });
    await f.runtime.onApplicationBootstrap();
    await f.runtime.onModuleDestroy();
    expect(f.createPool).not.toHaveBeenCalled();
    expect(f.createBroker).not.toHaveBeenCalled();
    expect(f.runtime.status()).toMatchObject({
      enabled: false,
      running: false,
    });
  });
  it('fails closed on an unsafe database and cleans up exactly once', async () => {
    const f = fixture();
    f.query.mockResolvedValue({ rows: [{ passed: false }] });
    await expect(f.runtime.onApplicationBootstrap()).rejects.toThrow(
      'DATABASE_UNSAFE',
    );
    await f.runtime.onModuleDestroy();
    expect(f.end).toHaveBeenCalledTimes(1);
    expect(f.createBroker).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
  it('redacts startup query errors and closes its pool', async () => {
    const f = fixture();
    f.query.mockRejectedValue(new Error('private-sql-connection'));
    await expect(f.runtime.onApplicationBootstrap()).rejects.toThrow(
      new Error('MQTT_REVOCATION_STARTUP_UNAVAILABLE'),
    );
    expect(f.end).toHaveBeenCalledTimes(1);
  });
  it('handles shutdown during initial audit without starting work or double-ending the pool', async () => {
    const f = fixture();
    let auditDone!: (result: { rows: unknown[] }) => void;
    f.query.mockImplementation(
      () =>
        new Promise((resolve) => {
          auditDone = resolve;
        }),
    );
    const starting = f.runtime.onApplicationBootstrap();
    const stopping = f.runtime.onModuleDestroy();
    auditDone(safe);
    await starting;
    await stopping;
    await f.runtime.onModuleDestroy();
    expect(f.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(f.runtime.status().running).toBe(false);
  });
  it('sets verified database TLS and bounded operations in production', async () => {
    const f = fixture({ NODE_ENV: 'production' });
    await f.runtime.onApplicationBootstrap();
    expect(f.createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        max: 1,
        query_timeout: 5000,
        statement_timeout: 5000,
        lock_timeout: 3000,
        ssl: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        user: 'revoker',
      }),
    );
    expect(f.createBroker).toHaveBeenCalledWith(
      'mqtts://broker.test',
      expect.objectContaining({
        username: 'admin',
        password: 'admin-fixture',
        clientId: 'worker-1',
        reconnectPeriod: 0,
      }),
    );
    await f.runtime.onModuleDestroy();
  });
  it('rejects an unreadable CA before opening a pool, without disclosing its path', async () => {
    const f = fixture({
      DATABASE_MQTT_REVOKE_TLS: 'true',
      DATABASE_MQTT_REVOKE_CA_FILE: 'missing-sensitive-location.pem',
    });
    await expect(f.runtime.onApplicationBootstrap()).rejects.toThrow(
      new Error('MQTT_REVOCATION_DATABASE_CA_INVALID'),
    );
    expect(f.createPool).not.toHaveBeenCalled();
  });
});
