// Does not connect to PostgreSQL: validates target allowlisting before credentials are used.
jest.mock('pg', () => ({ Pool: jest.fn() }));

import { parseMqttWorkerConnection } from './mqtt-worker-pg.gateway';

const forWorker = (kind: 'lease' | 'confirmer', host = 'smarthome_pg_039_lab', db = 'smarthome_039_lab') =>
  `postgresql://smarthome_mqtt_${kind}_lab039_login:${'a'.repeat(43)}@${host}:5432/${db}`;

describe('MQTT worker lab mode / isolated container only', () => {
  it.each(['lease', 'confirmer'] as const)('allows exact %s lab credentials only outside production', kind => {
    const target = parseMqttWorkerConnection(forWorker(kind), kind, 'lab', 'development');
    expect(target.role).toBe(`smarthome_mqtt_${kind}_lab039_login`);
    expect(target.database).toBe('smarthome_039_lab');
    expect(target.options.ssl).toBe(false);
    expect(() => parseMqttWorkerConnection(forWorker(kind), kind, 'lab', 'production'))
      .toThrow('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
  });

  it('rejects a different host, a different database and cross-role login', () => {
    expect(() => parseMqttWorkerConnection(forWorker('lease', 'postgres'), 'lease', 'lab', 'development'))
      .toThrow('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
    expect(() => parseMqttWorkerConnection(forWorker('lease', 'smarthome_pg_039_lab', 'smarthome'), 'lease', 'lab', 'development'))
      .toThrow('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
    expect(() => parseMqttWorkerConnection(forWorker('lease'), 'confirmer', 'lab', 'development'))
      .toThrow('MQTT_WORKER_DATABASE_URL_INVALID');
  });

  it('rejects URL parameters and using lab accounts in remote or local-dev modes', () => {
    expect(() => parseMqttWorkerConnection(`${forWorker('lease')}?sslmode=disable`, 'lease', 'lab', 'development'))
      .toThrow('MQTT_WORKER_DATABASE_URL_INVALID');
    expect(() => parseMqttWorkerConnection(forWorker('lease'), 'lease', 'remote-tls', 'development'))
      .toThrow('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
    expect(() => parseMqttWorkerConnection(forWorker('lease'), 'lease', 'local-dev', 'development'))
      .toThrow('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
  });
});
