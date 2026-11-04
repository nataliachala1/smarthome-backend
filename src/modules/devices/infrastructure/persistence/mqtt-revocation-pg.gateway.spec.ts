import {
  isAllowedMqttRevocationQuery,
  MqttRevocationPgGateway,
  parseMqttRevocationConnection,
} from './mqtt-revocation-pg.gateway';

const pass = 'A'.repeat(43);
const vpsUrl = (role = 'smarthome_mqtt_revoke_dev_login', host = 'smart-home-smarthomepostgresdev-vrmtpz') =>
  `postgresql://${role}:${pass}@${host}:5432/smarthome_dev`;
const privilegeRow = {
  role: 'smarthome_mqtt_revoke_dev_login', database: 'smarthome_dev',
  revoke_member: true, can_claim_pairing: true, can_finish_pairing: true,
  can_claim_identity: true, can_finish_identity: true,
  registrar_member: false, lease_member: false, reserver_member: false,
  secret_member: false, rpc_member: false, auth_member: false, runtime_member: false,
  can_claim_legacy_identity: false, can_finish_legacy_identity: false,
  can_reserve: false, can_register: false, operation_dml: false,
  identity_dml: false, evidence_dml: false, is_superuser: false,
  secret_dml: false, rpc_dml: false, state_event_dml: false,
  auth_evidence_dml: false, session_dml: false, device_dml: false,
  isolated_membership: true, can_replicate: false,
  can_create_schema: false, can_create_objects: false,
  bypass_rls: false, can_create_role: false, can_create_db: false,
};

describe('MQTT revocation PostgreSQL gate', () => {
  it('uses certificate-validated TLS and exact DEV target for VPS', () => {
    const target = parseMqttRevocationConnection(vpsUrl(), 'vps-dev-tls', 'production');
    expect(target).toMatchObject({ role: privilegeRow.role, database: 'smarthome_dev' });
    expect(target.options.ssl).toEqual({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    expect(target.options.application_name).toBe('smarthome_mqtt_revoke');
  });

  it.each([
    undefined,
    vpsUrl('smarthome_runtime_login'),
    vpsUrl('smarthome_mqtt_revoke_dev_login', 'production-db'),
    vpsUrl().replace('/smarthome_dev', '/smarthome'),
    `${vpsUrl()}?sslmode=disable`,
    `postgresql://smarthome_mqtt_revoke_dev_login:short@smart-home-smarthomepostgresdev-vrmtpz:5432/smarthome_dev`,
  ])('rechaza configuración VPS de revocación insegura', (url) => {
    expect(() => parseMqttRevocationConnection(url, 'vps-dev-tls', 'production'))
      .toThrow(/MQTT_REVOCATION_DATABASE_(URL_INVALID|TARGET_NOT_ALLOWED)/);
  });

  it('mantiene modo local solo en loopback, development y sin TLS', () => {
    const url = `postgresql://smarthome_mqtt_revoke_dev_login:${pass}@127.0.0.1:5432/smarthome`;
    expect(parseMqttRevocationConnection(url, 'local-dev', 'development').options.ssl)
      .toBe(false);
    expect(() => parseMqttRevocationConnection(url, 'local-dev', 'production'))
      .toThrow('MQTT_REVOCATION_DATABASE_TARGET_NOT_ALLOWED');
  });

  it('solo permite las cuatro llamadas SQL de revocación', () => {
    expect(isAllowedMqttRevocationQuery(
      ' SELECT devices.fn_finish_mqtt_pairing_revocation(\n      $1::uuid,$2::uuid,$3::text,$4::text) AS finished ',
      ['a', 'b', 'c', 'd'],
    )).toBe(true);
    expect(isAllowedMqttRevocationQuery(
      'DELETE FROM devices.mqtt_identity', [],
    )).toBe(false);
    expect(isAllowedMqttRevocationQuery(
      'SELECT devices.fn_finish_mqtt_pairing_revocation($1::uuid,$2::uuid,$3::text,$4::text); SELECT 1',
      ['a', 'b', 'c', 'd'],
    )).toBe(false);
  });

  it('falla cerrado si los permisos son excesivos o incompletos', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [privilegeRow] }), end: jest.fn() };
    const gateway = new MqttRevocationPgGateway(pool, {
      role: privilegeRow.role, database: privilegeRow.database,
    });
    await gateway.verifyPrivileges();
    const claimSql = `SELECT identity_id::text AS "identityId",claim_token::text AS "leaseToken",
      attempt,operation_id::text AS "operationId", revocation_probe_at AS "revocationProbeAt",
      broker_username AS username,broker_client_id AS "clientId",
      broker_role_name AS "roleName"
      FROM devices.fn_claim_mqtt_revocation_with_binding()`;
    expect(isAllowedMqttRevocationQuery(claimSql, [])).toBe(true);
    await expect(gateway.query(claimSql, []))
      .resolves.toMatchObject({ rows: [privilegeRow] });

    pool.query.mockResolvedValueOnce({ rows: [{ ...privilegeRow, operation_dml: true }] });
    await expect(gateway.verifyPrivileges()).rejects.toThrow('MQTT_REVOCATION_PRIVILEGES_UNVERIFIED');
    await expect(gateway.query('DELETE FROM devices.mqtt_identity', []))
      .rejects.toThrow('MQTT_REVOCATION_NOT_READY');
  });
});
