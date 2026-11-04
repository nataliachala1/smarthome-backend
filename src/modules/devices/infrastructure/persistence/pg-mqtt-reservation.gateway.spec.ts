import {
  PgMqttReservationGateway,
  isMinimalMqttReservationPrivilegeRow,
  parseMqttReservationLabConnection,
} from './pg-mqtt-reservation.gateway';

const url = 'postgresql://smarthome_mqtt_reserver_lab039_login:' + 'A'.repeat(43) +
  '@smarthome_pg_039_lab:5432/smarthome_039_lab';
const row: Record<string, unknown> = {
  role: 'smarthome_mqtt_reserver_lab039_login', database: 'smarthome_039_lab',
  reserver_usage: true, schema_usage: true, can_reserve: true,
  can_login: true, inherits: true, direct_memberships: 1,
  lease_member: false, confirmer_member: false, registrar_member: false,
  revoke_member: false, can_claim: false, can_report: false,
  can_quarantine: false, can_confirm: false, can_register: false,
  operation_select: false, operation_insert: false, operation_update: false,
  operation_delete: false, identity_select: false, session_select: false,
  superuser: false, bypass_rls: false, create_role: false, create_db: false,
  replication: false,
};
const reserveSql = `SELECT operation_id::text AS "operationId",
                identity_id::text AS "identityId",
                username::text AS "username",
                client_id::text AS "clientId",
                role_name::text AS "roleName",
                reserved_topic_scope::text AS "reservedTopicScope"
           FROM devices.fn_reserve_mqtt_pairing_operation(
             $1::uuid, $2::text, $3::uuid, $4::text
           )`;
const reserveParams = [
  '11111111-1111-4111-8111-111111111111',
  'devices/lab039/fixture',
  '22222222-2222-4222-8222-222222222222',
  'a'.repeat(64),
];

describe('PgMqttReservationGateway lab only', () => {
  it('accepts exact lab destination in development', () => {
    const target = parseMqttReservationLabConnection(url, 'development');
    expect(target.role).toBe('smarthome_mqtt_reserver_lab039_login');
    expect(target.options.ssl).toBe(false);
  });
  it.each([
    ['production', url],
    ['development', url.replace('smarthome_pg_039_lab', '127.0.0.1')],
    ['development', url.replace('smarthome_039_lab', 'smarthome')],
    ['development', url.replace('reserver_lab039_login', 'lease_lab039_login')],
    ['development', url + '?sslmode=disable'],
    ['development', url.replace('smarthome_pg_039_lab', 'smarthome_pg_027_lab')],
    ['development', url.replace('smarthome_039_lab', 'smarthome_027_lab')],
    ['development', url.replace('reserver_lab039_login', 'reserver_lab_login')],
  ])('rejects unsafe destination %s', (env, input) => {
    expect(() => parseMqttReservationLabConnection(input, env)).toThrow();
  });
  it('requires all exact role privileges', () => {
    expect(isMinimalMqttReservationPrivilegeRow(row)).toBe(true);
  });
  it.each([
    { can_reserve: false }, { can_claim: true }, { can_confirm: true },
    { operation_select: true }, { lease_member: true },
    { direct_memberships: 2 }, { superuser: true },
    { role: 'smarthome_owner' }, { session_select: true },
    { inherits: false },
  ])('fails closed if privilege diverges: %p', (change) => {
    expect(isMinimalMqttReservationPrivilegeRow({ ...row, ...change })).toBe(false);
  });
  it('blocks query until verified and rejects extra SQL', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }), end: jest.fn() };
    const gateway = new PgMqttReservationGateway(pool);
    await expect(gateway.query(reserveSql, reserveParams)).rejects.toThrow('MQTT_RESERVER_NOT_READY');
    await gateway.verifyPrivileges();
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_RESERVER_SQL_NOT_ALLOWED');
    await expect(gateway.query(reserveSql, reserveParams)).resolves.toEqual({ rows: [row] });
    await gateway.close();
  });
  it('fails closed on incorrect privilege response', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ ...row, can_claim: true }] }), end: jest.fn() };
    const gateway = new PgMqttReservationGateway(pool);
    await expect(gateway.verifyPrivileges()).rejects.toThrow('MQTT_RESERVER_PRIVILEGES_UNVERIFIED');
  });
});
