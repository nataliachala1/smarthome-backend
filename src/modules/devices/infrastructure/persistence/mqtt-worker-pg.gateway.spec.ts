// Evitar abrir un pool real: los tests ejercitan el parser y la comprobacion de privilegios.
jest.mock('pg', () => ({ Pool: jest.fn() }));

import {
  MqttWorkerPgGateway,
  isMinimalMqttWorkerPrivilegeRow,
  parseMqttWorkerConnection,
  type MqttWorkerPrivilegeRow,
} from './mqtt-worker-pg.gateway';

const lease = 'postgresql://smarthome_mqtt_lease_dev_login:secret-test@127.0.0.1:5432/smarthome';
const confirmer = 'postgresql://smarthome_mqtt_confirmer_dev_login:secret-test@127.0.0.1:5432/smarthome';

function row(kind: 'lease' | 'confirmer'): MqttWorkerPrivilegeRow {
  return {
    role: kind === 'lease' ? 'smarthome_mqtt_lease_dev_login' : 'smarthome_mqtt_confirmer_dev_login',
    database: 'smarthome',
    lease_member: kind === 'lease', confirmer_member: kind === 'confirmer',
    reserver_member: false, registrar_member: false, revoke_member: false,
    can_claim: kind === 'lease', can_report: kind === 'lease', can_quarantine: kind === 'lease',
    can_confirm: kind === 'confirmer', can_reserve: false, can_register: false,
    can_read_operation: false, can_insert_operation: false,
    can_update_operation: false, can_delete_operation: false, can_read_identity: false,
    is_superuser: false, bypass_rls: false, can_create_role: false, can_create_db: false,
  };
}

describe('MQTT worker PG / no privilege crossover', () => {
  it('permite local-dev solo con destino y login exactos para cada rol', () => {
    const a = parseMqttWorkerConnection(lease, 'lease', 'local-dev', 'development');
    const b = parseMqttWorkerConnection(confirmer, 'confirmer', 'local-dev', 'development');
    expect(a.options.ssl).toBe(false);
    expect(b.options.ssl).toBe(false);
    expect(a.role).not.toBe(b.role);
    expect(() => parseMqttWorkerConnection(lease, 'confirmer', 'local-dev', 'development'))
      .toThrow('MQTT_WORKER_DATABASE_URL_INVALID');
  });

  it('bloquea uso de local-dev en produccion y URLs que alteran opciones', () => {
    expect(() => parseMqttWorkerConnection(lease, 'lease', 'local-dev', 'production'))
      .toThrow('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
    expect(() => parseMqttWorkerConnection(`${lease}?sslmode=disable`, 'lease', 'local-dev', 'development'))
      .toThrow('MQTT_WORKER_DATABASE_URL_INVALID');
  });

  it('obliga TLS verificable fuera del host local', () => {
    expect(() => parseMqttWorkerConnection(lease, 'lease', 'remote-tls', 'production'))
      .toThrow('MQTT_WORKER_DATABASE_TARGET_NOT_ALLOWED');
    const remote = parseMqttWorkerConnection(
      'postgresql://smarthome_mqtt_lease_worker_login:placeholder@db.example.net:5432/smarthome',
      'lease', 'remote-tls', 'production',
    );
    expect(remote.options.ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it.each(['lease', 'confirmer'] as const)('acepta SOLO privilegios exactos para %s', (kind) => {
    const p = row(kind);
    expect(isMinimalMqttWorkerPrivilegeRow(p, p, kind)).toBe(true);
    expect(isMinimalMqttWorkerPrivilegeRow({ ...p, can_reserve: true }, p, kind)).toBe(false);
    expect(isMinimalMqttWorkerPrivilegeRow({ ...p, can_read_operation: true }, p, kind)).toBe(false);
    expect(isMinimalMqttWorkerPrivilegeRow({ ...p, registrar_member: true }, p, kind)).toBe(false);
    expect(isMinimalMqttWorkerPrivilegeRow({ ...p, is_superuser: true }, p, kind)).toBe(false);
  });

  it('requiere verificacion antes de usar la conexion', async () => {
    const p = row('lease');
    const query = jest.fn().mockResolvedValue({ rows: [p] });
    const end = jest.fn().mockResolvedValue(undefined);
    const gateway = new MqttWorkerPgGateway({ query, end }, p, 'lease');
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_WORKER_NOT_READY');
    await gateway.verifyPrivileges();
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_WORKER_SQL_NOT_ALLOWED');
    expect(query).toHaveBeenCalledTimes(1);
    await gateway.onModuleDestroy();
    expect(end).toHaveBeenCalledTimes(1);
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_WORKER_NOT_READY');
  });

  it('rechaza permisos de otro worker aunque ambos tengan funciones validas', async () => {
    const p = { ...row('lease'), can_confirm: true };
    const query = jest.fn().mockResolvedValue({ rows: [p] });
    const end = jest.fn().mockResolvedValue(undefined);
    const gateway = new MqttWorkerPgGateway({ query, end }, p, 'lease');
    await expect(gateway.verifyPrivileges()).rejects.toThrow('MQTT_WORKER_PRIVILEGES_UNVERIFIED');
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_WORKER_NOT_READY');
  });
});
