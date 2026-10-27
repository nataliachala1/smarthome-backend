import {
  isMinimalMqttAuthPgPrivileges,
  MqttAuthenticationPgGateway,
  parseMqttAuthPgConnection,
} from './mqtt-authentication-pg.gateway';

describe('MQTT rpc/auth VPS DEV: aislamiento y TLS obligatorio', () => {
  const host = 'smart-home-smarthomepostgresdev-vrmtpz';
  const password = 'A'.repeat(43); // contraseña sintética, nunca real
  const make = (
    role: string,
    database = 'smarthome_dev',
    server = host,
  ) => `postgresql://${role}:${password}@${server}:5432/${database}`;
  const rpc = 'smarthome_mqtt_rpc_dev_login';
  const confirm = 'smarthome_mqtt_auth_dev_login';

  it.each([
    ['rpc', rpc], ['confirm', confirm],
  ] as const)('admite %s solo con rol propio y TLS verificado', (kind, role) => {
    const target = parseMqttAuthPgConnection(make(role), kind, 'vps-dev-tls', 'production');
    expect(target.role).toBe(role);
    expect(target.database).toBe('smarthome_dev');
    expect(target.options.ssl).toEqual({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
  });

  it('rechaza intercambio de las cuentas rpc y confirmer', () => {
    expect(() => parseMqttAuthPgConnection(make(confirm), 'rpc', 'vps-dev-tls', 'production'))
      .toThrow('MQTT_AUTH_PG_TARGET_NOT_ALLOWED');
    expect(() => parseMqttAuthPgConnection(make(rpc), 'confirm', 'vps-dev-tls', 'production'))
      .toThrow('MQTT_AUTH_PG_TARGET_NOT_ALLOWED');
  });

  it.each([
    [rpc, 'smarthome', host],
    [rpc, 'smarthome_dev', '127.0.0.1'],
    [rpc, 'smarthome_dev', 'example.com'],
  ])('rechaza destino no permitido', (role, database, server) => {
    expect(() => parseMqttAuthPgConnection(make(role, database, server), 'rpc', 'vps-dev-tls', 'production'))
      .toThrow('MQTT_AUTH_PG_TARGET_NOT_ALLOWED');
  });

  it('rechaza parámetros de URL que podrían sobreescribir TLS', () => {
    for (const extra of ['?sslmode=disable', '?sslrootcert=anything', '#fragment']) {
      expect(() => parseMqttAuthPgConnection(`${make(rpc)}${extra}`, 'rpc', 'vps-dev-tls', 'production'))
        .toThrow('MQTT_AUTH_PG_TARGET_NOT_ALLOWED');
    }
  });

  it('rechaza VPS DEV bajo NODE_ENV distinto de production', () => {
    expect(() => parseMqttAuthPgConnection(make(rpc), 'rpc', 'vps-dev-tls', 'development'))
      .toThrow('MQTT_AUTH_PG_TARGET_NOT_ALLOWED');
  });

  it('conserva local-dev exclusivamente en development, sin TLS', () => {
    const local = make(rpc, 'smarthome', '127.0.0.1');
    expect(parseMqttAuthPgConnection(local, 'rpc', 'local-dev', 'development').options.ssl)
      .toBe(false);
    expect(() => parseMqttAuthPgConnection(local, 'rpc', 'local-dev', 'production'))
      .toThrow('MQTT_AUTH_PG_DEV_ONLY');
  });

  it('valida que la base reportada en el chequeo de privilegios sea la correcta', async () => {
    const result = {
      login: rpc, db: 'smarthome', member_rpc: true, member_confirm: false,
      usable_rpc: true, usable_confirm: false, memberships: 1,
      can_issue: true, can_consume: true, can_confirm: false,
      can_reserve: false, can_prepare: false, can_register: false, can_finish: false,
      can_read_operations: false, can_edit_operations: false,
      can_read_secrets: false, can_write_secrets: false, privileged: false,
    };
    expect(isMinimalMqttAuthPgPrivileges(result, 'rpc')).toBe(true);
    expect(isMinimalMqttAuthPgPrivileges(result, 'rpc', 'smarthome_dev')).toBe(false);
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [result] }),
      end: jest.fn().mockResolvedValue(undefined),
    };
    const gateway = new MqttAuthenticationPgGateway(pool, 'rpc', 'smarthome_dev');
    await expect(gateway.verifyPrivileges()).rejects.toThrow('MQTT_AUTH_PG_PRIVILEGES_REJECTED');
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_AUTH_PG_QUERY_REJECTED');
    await gateway.onModuleDestroy();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
