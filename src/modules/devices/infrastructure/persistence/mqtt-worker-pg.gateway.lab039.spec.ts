import {
  MqttWorkerPgGateway,
  isMinimalMqttWorkerPrivilegeRow,
  parseMqttWorkerConnection,
  type MqttWorkerKind,
} from './mqtt-worker-pg.gateway';

const token = 'A'.repeat(43);
const lab039 = (kind: MqttWorkerKind) =>
  `postgresql://smarthome_mqtt_${kind}_lab039_login:${token}@smarthome_pg_039_lab:5432/smarthome_039_lab`;

function privilegeRow(kind: MqttWorkerKind): Record<string, unknown> {
  return {
    role: `smarthome_mqtt_${kind}_lab039_login`, database: 'smarthome_039_lab',
    lease_member: kind === 'lease', confirmer_member: kind === 'confirmer',
    reserver_member: false, registrar_member: false, revoke_member: false,
    can_claim: kind === 'lease', can_report: kind === 'lease',
    can_quarantine: kind === 'lease', can_confirm: kind === 'confirmer',
    can_reserve: false, can_register: false,
    can_read_operation: false, can_insert_operation: false,
    can_update_operation: false, can_delete_operation: false,
    can_read_identity: false, is_superuser: false, bypass_rls: false,
    can_create_role: false, can_create_db: false,
  };
}

describe('MqttWorkerPgGateway LAB039 - fenced destinations', () => {
  it.each(['lease', 'confirmer'] as const)('permits %s only in lab039', kind => {
    const target = parseMqttWorkerConnection(lab039(kind), kind, 'lab', 'development');
    expect(target.role).toBe(`smarthome_mqtt_${kind}_lab039_login`);
    expect(target.database).toBe('smarthome_039_lab');
    expect(target.options.ssl).toBe(false);
    expect(target.options.connectionString).toBe(lab039(kind));
    expect(isMinimalMqttWorkerPrivilegeRow(privilegeRow(kind), target, kind)).toBe(true);
  });
  it.each(['lease', 'confirmer'] as const)('rejects old LAB027 %s credentials and host', kind => {
    const url = lab039(kind);
    for (const changed of [
      url.replace('smarthome_pg_039_lab', 'smarthome_pg_027_lab'),
      url.replace('smarthome_039_lab', 'smarthome_027_lab'),
      url.replace('_lab039_login', '_lab_login'),
      url.replace('smarthome_pg_039_lab', '127.0.0.1'),
      url.replace(token, 'abc'),
      url + '?sslmode=disable',
    ]) {
      expect(() => parseMqttWorkerConnection(changed, kind, 'lab', 'development')).toThrow();
    }
    expect(() => parseMqttWorkerConnection(url, kind, 'lab', 'production')).toThrow();
    expect(() => parseMqttWorkerConnection(url, kind, 'remote-tls', 'production')).toThrow();
  });
  it.each(['lease', 'confirmer'] as const)('denies switched accounts: %s', kind => {
    const other: MqttWorkerKind = kind === 'lease' ? 'confirmer' : 'lease';
    expect(() => parseMqttWorkerConnection(lab039(other), kind, 'lab', 'development')).toThrow();
  });
  it.each(['lease', 'confirmer'] as const)('fails closed on privileges for %s', kind => {
    const target = parseMqttWorkerConnection(lab039(kind), kind, 'lab', 'test');
    for (const change of [
      { role: 'smarthome_owner' }, { database: 'smarthome_027_lab' },
      { can_reserve: true }, { can_read_operation: true },
      { is_superuser: true }, { can_create_role: true },
      { lease_member: kind !== 'lease' },
      { confirmer_member: kind !== 'confirmer' },
    ]) {
      expect(isMinimalMqttWorkerPrivilegeRow({ ...privilegeRow(kind), ...change }, target, kind)).toBe(false);
    }
  });
  it.each(['lease', 'confirmer'] as const)('blocks use before verify and incorrect privileges: %s', async kind => {
    const target = parseMqttWorkerConnection(lab039(kind), kind, 'lab', 'test');
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ ...privilegeRow(kind), can_reserve: true }] }), end: jest.fn() };
    const gateway = new MqttWorkerPgGateway(pool, target, kind);
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_WORKER_NOT_READY');
    await expect(gateway.verifyPrivileges()).rejects.toThrow('MQTT_WORKER_PRIVILEGES_UNVERIFIED');
    expect(pool.query).toHaveBeenCalledTimes(1);
    await gateway.onModuleDestroy();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
  it.each(['lease', 'confirmer'] as const)('verifies correct privileges then closes: %s', async kind => {
    const target = parseMqttWorkerConnection(lab039(kind), kind, 'lab', 'test');
    const pool = { query: jest.fn().mockResolvedValue({ rows: [privilegeRow(kind)] }), end: jest.fn() };
    const gateway = new MqttWorkerPgGateway(pool, target, kind);
    await gateway.verifyPrivileges();
    await gateway.onModuleDestroy();
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_WORKER_NOT_READY');
  });
});
