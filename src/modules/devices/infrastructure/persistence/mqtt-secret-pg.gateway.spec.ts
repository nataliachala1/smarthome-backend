import {
  MqttSecretPgGateway,
  allowedMqttSecretQuery,
  minimalMqttSecretPrivileges,
  parseMqttSecretDevConnection,
} from './mqtt-secret-pg.gateway';

const role = 'smarthome_mqtt_secret_dev_login';
const database = 'smarthome';
const privilegeRow = {
  role, database, inherit: true, superuser: false, bypassrls: false,
  createrole: false, createdb: false, replication: false,
  secret_member: true, reserve_member: false, lease_member: false,
  confirm_member: false, membership_count: 1,
  can_load: true, can_insert_secret: true, can_reserve: false,
  can_claim: false, can_confirm: false, secret_dml: false,
  operation_dml: false, identity_dml: false,
};

describe('MqttSecretPgGateway (SQL028, sin red)', () => {
  it('acepta exclusivamente el destino local de desarrollo', () => {
    const pw = 'A'.repeat(43);
    const valid = `postgresql://${role}:${pw}@127.0.0.1:5432/smarthome`;
    expect(parseMqttSecretDevConnection(valid, 'development').role).toBe(role);
    expect(() => parseMqttSecretDevConnection(valid, 'production')).toThrow();
    expect(() => parseMqttSecretDevConnection(valid.replace('127.0.0.1', 'localhost'), 'development')).toThrow();
    expect(() => parseMqttSecretDevConnection(valid.replace(role, 'postgres'), 'development')).toThrow();
    expect(() => parseMqttSecretDevConnection(valid + '?sslmode=disable', 'development')).toThrow();
  });

  it('rechaza privilegios ajenos y membresías inesperadas', () => {
    expect(minimalMqttSecretPrivileges(privilegeRow, { role, database })).toBe(true);
    expect(minimalMqttSecretPrivileges({ ...privilegeRow, reserve_member: true }, { role, database })).toBe(false);
    expect(minimalMqttSecretPrivileges({ ...privilegeRow, secret_dml: true }, { role, database })).toBe(false);
    expect(minimalMqttSecretPrivileges({ ...privilegeRow, membership_count: 2 }, { role, database })).toBe(false);
  });

  it('restringe las dos llamadas SQL028 y prohíbe SQL arbitrario', () => {
    expect(allowedMqttSecretQuery(
      'SELECT operation_id, format_version, key_id, nonce, ciphertext, auth_tag FROM devices.fn_load_mqtt_preparation_secret($1::uuid, $2::uuid)',
      ['a', 'b'],
    )).toBe(true);
    expect(allowedMqttSecretQuery(
      `SELECT devices.fn_insert_mqtt_preparation_secret_if_absent(
  $1::uuid, $2::uuid, $3::smallint, $4::text, $5::text, $6::text, $7::text
) AS inserted`,
      Array(7).fill('x'),
    )).toBe(true);
    expect(allowedMqttSecretQuery('DELETE FROM devices.mqtt_preparation_secret', [])).toBe(false);
    expect(allowedMqttSecretQuery('SELECT 1;', [])).toBe(false);
  });

  it('falla cerrado hasta verificar grants y bloquea consultas no permitidas', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [privilegeRow] }),
      end: jest.fn().mockResolvedValue(undefined),
    };
    const gateway = new MqttSecretPgGateway(pool, { role, database });
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_SECRET_NOT_READY');
    await gateway.verifyPrivileges();
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_SECRET_SQL_NOT_ALLOWED');
    await gateway.onModuleDestroy();
    expect(pool.end).toHaveBeenCalledTimes(1);
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_SECRET_NOT_READY');
  });
});
