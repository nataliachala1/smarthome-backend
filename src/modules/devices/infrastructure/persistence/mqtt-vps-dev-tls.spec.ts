// Validación local sin crear pools ni conectarse a PostgreSQL.
jest.mock('pg', () => ({ Pool: jest.fn() }));
import { parseMqttReserverConnection } from './mqtt-reserver-pg.gateway';
import { parseMqttWorkerConnection } from './mqtt-worker-pg.gateway';

const host = 'smart-home-smarthomepostgresdev-vrmtpz';
const db = 'smarthome_dev';
const password = 'A'.repeat(43); // Contraseña ficticia; no usar secretos reales.
const make = (role: string, hostname = host, database = db) =>
  `postgresql://${role}:${password}@${hostname}:5432/${database}`;

const accounts = [
  ['reserver', 'smarthome_mqtt_reserver_dev_login'],
  ['lease', 'smarthome_mqtt_lease_dev_login'],
  ['confirmer', 'smarthome_mqtt_confirmer_dev_login'],
] as const;

describe('MQTT PostgreSQL VPS DEV: aislamiento y TLS obligatorio', () => {
  it('permite únicamente la cuenta reserver DEV con TLS verificable', () => {
    const target = parseMqttReserverConnection(make(accounts[0][1]), 'vps-dev-tls', 'production');
    expect(target.role).toBe(accounts[0][1]);
    expect(target.database).toBe(db);
    expect(target.options.ssl).toMatchObject({
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    });
  });

  it.each(['lease', 'confirmer'] as const)('permite %s solo con rol individual y TLS', (kind) => {
    const role = kind === 'lease' ? accounts[1][1] : accounts[2][1];
    const target = parseMqttWorkerConnection(make(role), kind, 'vps-dev-tls', 'production');
    expect(target.role).toBe(role);
    expect(target.database).toBe(db);
    expect(target.options.ssl).toMatchObject({
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    });
  });

  it.each(accounts)('rechaza un host distinto para %s', (kind, role) => {
    if (kind === 'reserver') {
      expect(() => parseMqttReserverConnection(make(role, 'postgres'), 'vps-dev-tls', 'production'))
        .toThrow('MQTT_RESERVER_DATABASE_TARGET_NOT_ALLOWED');
    } else {
      expect(() => parseMqttWorkerConnection(make(role, 'postgres'), kind, 'vps-dev-tls', 'production'))
        .toThrow('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
    }
  });

  it.each(accounts)('rechaza otra base en %s', (kind, role) => {
    if (kind === 'reserver') {
      expect(() => parseMqttReserverConnection(make(role, host, 'smarthome'), 'vps-dev-tls', 'production'))
        .toThrow('MQTT_RESERVER_DATABASE_TARGET_NOT_ALLOWED');
    } else {
      expect(() => parseMqttWorkerConnection(make(role, host, 'smarthome'), kind, 'vps-dev-tls', 'production'))
        .toThrow('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
    }
  });

  it('rechaza intercambio de cuentas entre lease y confirmer', () => {
    expect(() => parseMqttWorkerConnection(make(accounts[2][1]), 'lease', 'vps-dev-tls', 'production'))
      .toThrow('MQTT_WORKER_DATABASE_URL_INVALID');
  });

  it('rechaza VPS DEV en otros entornos NODE_ENV', () => {
    expect(() => parseMqttReserverConnection(make(accounts[0][1]), 'vps-dev-tls', 'development'))
      .toThrow('MQTT_RESERVER_DATABASE_TARGET_NOT_ALLOWED');
    expect(() => parseMqttWorkerConnection(make(accounts[1][1]), 'lease', 'vps-dev-tls', 'development'))
      .toThrow('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
  });

  it('rechaza parámetros URL que puedan alterar TLS', () => {
    const url = make(accounts[0][1]) + '?sslmode=disable';
    expect(() => parseMqttReserverConnection(url, 'vps-dev-tls', 'production'))
      .toThrow('MQTT_RESERVER_DATABASE_URL_INVALID');
    expect(() => parseMqttWorkerConnection(make(accounts[1][1]) + '?sslmode=disable', 'lease', 'vps-dev-tls', 'production'))
      .toThrow('MQTT_WORKER_DATABASE_URL_INVALID');
  });
});
