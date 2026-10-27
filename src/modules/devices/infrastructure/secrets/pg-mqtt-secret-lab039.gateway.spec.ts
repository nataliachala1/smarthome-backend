import {
  PgMqttSecretLab039Gateway,
  SECRET_LAB039_PRIVILEGE_SQL,
  hasMinimalSecretLab039Privileges,
  parseSecretLab039Url,
} from './pg-mqtt-secret-lab039.gateway';

const URL039 = 'postgresql://smarthome_mqtt_secret_lab039_login:' + 'A'.repeat(43) +
  '@smarthome_pg_039_lab:5432/smarthome_039_lab';
const allowed: Record<string, unknown> = {
  database: 'smarthome_039_lab', role: 'smarthome_mqtt_secret_lab039_login',
  session_role: 'smarthome_mqtt_secret_lab039_login', can_login: true,
  inherits: true, superuser: false, create_db: false, create_role: false,
  replication: false, bypass_rls: false, direct_memberships: 1,
  secret_member: true, reserver_member: false, lease_member: false,
  confirmer_member: false, owner_member: false, schema_usage: true,
  can_load: true, can_insert: true, can_reserve: false, can_claim: false,
  can_confirm: false, secret_select: false, secret_insert: false,
  secret_update: false, secret_delete: false, operation_select: false,
  identity_select: false,
};
const load = `SELECT operation_id, format_version, key_id, nonce,
  ciphertext, auth_tag
FROM devices.fn_load_mqtt_preparation_secret($1::uuid, $2::uuid)`;
const insert = `SELECT devices.fn_insert_mqtt_preparation_secret_if_absent(
  $1::uuid, $2::uuid, $3::smallint, $4::text, $5::text, $6::text, $7::text
) AS inserted`;

describe('PgMqttSecretLab039Gateway - only lab039, no DI', () => {
  it('accepts exact restricted target only in test/development', () => {
    const t = parseSecretLab039Url(URL039, 'development');
    expect(t.options.ssl).toBe(false);
    expect(t.options.max).toBe(1);
    expect(t.role).toBe(allowed.role);
  });
  it.each([
    ['production', URL039], ['undefined', URL039],
    ['development', URL039.replace('smarthome_pg_039_lab', '127.0.0.1')],
    ['development', URL039.replace('smarthome_039_lab', 'smarthome_027_lab')],
    ['development', URL039.replace('_lab039_login', '_lab_login')],
    ['development', URL039 + '?sslmode=disable'],
    ['development', URL039.replace('postgresql:', 'postgres:')],
  ])('fails closed for forbidden target/environment %s', (env, u) => {
    expect(() => parseSecretLab039Url(u, env)).toThrow();
  });
  it('verifies strictly limited SQL role', () => {
    expect(hasMinimalSecretLab039Privileges(allowed)).toBe(true);
  });
  it.each([
    { database: 'smarthome_027_lab' }, { direct_memberships: 2 },
    { can_load: false }, { can_claim: true }, { superuser: true },
    { secret_select: true }, { owner_member: true }, { role: 'smarthome_owner' },
    { operation_select: true }, { inherits: false }, { secret_member: false },
  ])('rejects privilege drift %p', change => {
    expect(hasMinimalSecretLab039Privileges({ ...allowed, ...change })).toBe(false);
  });
  it('denies SQL before verification, any arbitrary SQL, permits only 2 exact function calls', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [allowed] }), end: jest.fn().mockResolvedValue(undefined) };
    const gateway = new PgMqttSecretLab039Gateway(pool);
    await expect(gateway.query(load, ['id', 'token'])).rejects.toThrow('MQTT_SECRET_LAB039_NOT_READY');
    await gateway.verifyPrivileges();
    expect(pool.query).toHaveBeenCalledWith(SECRET_LAB039_PRIVILEGE_SQL);
    await expect(gateway.query('SELECT * FROM devices.mqtt_preparation_secret', [])).rejects.toThrow('MQTT_SECRET_LAB039_SQL_NOT_ALLOWED');
    await expect(gateway.query(load + '; SELECT 1', ['id', 'token'])).rejects.toThrow('MQTT_SECRET_LAB039_SQL_NOT_ALLOWED');
    await expect(gateway.query(load, ['id'])).rejects.toThrow('MQTT_SECRET_LAB039_SQL_NOT_ALLOWED');
    await expect(gateway.query(insert, Array(7).fill('x'))).resolves.toEqual({ rows: [allowed] });
    await expect(gateway.query(load, ['id', 'token'])).resolves.toEqual({ rows: [allowed] });
    await gateway.close();
    await expect(gateway.query(load, ['id', 'token'])).rejects.toThrow('MQTT_SECRET_LAB039_NOT_READY');
  });
  it('fails closed when privileges drift', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ ...allowed, can_reserve: true }] }), end: jest.fn() };
    const gateway = new PgMqttSecretLab039Gateway(pool);
    await expect(gateway.verifyPrivileges()).rejects.toThrow('MQTT_SECRET_LAB039_PRIVILEGES_UNVERIFIED');
  });
});
