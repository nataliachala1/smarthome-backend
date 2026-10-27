import {
  parseMqttAuthPgUrl, isMinimalMqttAuthPgPrivileges, MqttAuthenticationPgGateway,
} from './mqtt-authentication-pg.gateway';

const rpcLogin = 'smarthome_mqtt_rpc_dev_login';
const authLogin = 'smarthome_mqtt_auth_dev_login';
const pass = 'A'.repeat(43);
const validRow = (kind: 'rpc' | 'confirm') => ({
  login: kind === 'rpc' ? rpcLogin : authLogin,
  db: 'smarthome', member_rpc: kind === 'rpc', member_confirm: kind === 'confirm',
  usable_rpc: kind === 'rpc', usable_confirm: kind === 'confirm', memberships: 1,
  can_issue: kind === 'rpc', can_consume: kind === 'rpc', can_confirm: kind === 'confirm',
  can_reserve: false, can_prepare: false, can_register: false, can_finish: false,
  can_read_operations: false, can_edit_operations: false,
  can_read_secrets: false, can_write_secrets: false, privileged: false,
});

describe('Etapa1 cierre - dos logins separados y worker sin autoejecucion', () => {
  const oldNodeEnv = process.env.NODE_ENV;
  beforeEach(() => { process.env.NODE_ENV = 'development'; });
  afterAll(() => { process.env.NODE_ENV = oldNodeEnv; });

  it('exige el usuario exacto y PostgreSQL local de desarrollo', () => {
    expect(parseMqttAuthPgUrl(
      `postgresql://${rpcLogin}:${pass}@127.0.0.1:5432/smarthome`, 'rpc',
    ).role).toBe(rpcLogin);
    expect(() => parseMqttAuthPgUrl(
      `postgresql://${authLogin}:${pass}@127.0.0.1:5432/smarthome`, 'rpc',
    )).toThrow('MQTT_AUTH_PG_TARGET_NOT_ALLOWED');
    expect(() => parseMqttAuthPgUrl(
      `postgresql://${rpcLogin}:${pass}@192.168.1.24:5432/smarthome`, 'rpc',
    )).toThrow('MQTT_AUTH_PG_TARGET_NOT_ALLOWED');
  });

  it('rechaza heredar roles adicionales, DML o permisos ADMIN', () => {
    expect(isMinimalMqttAuthPgPrivileges(validRow('rpc'), 'rpc')).toBe(true);
    expect(isMinimalMqttAuthPgPrivileges(validRow('confirm'), 'confirm')).toBe(true);
    expect(isMinimalMqttAuthPgPrivileges({ ...validRow('rpc'), can_confirm: true }, 'rpc')).toBe(false);
    expect(isMinimalMqttAuthPgPrivileges({ ...validRow('confirm'), memberships: 2 }, 'confirm')).toBe(false);
    expect(isMinimalMqttAuthPgPrivileges({ ...validRow('confirm'), can_edit_operations: true }, 'confirm')).toBe(false);
  });

  it('no consulta SQL operativa sin previa verificacion', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [validRow('rpc')] }),
      end: jest.fn().mockResolvedValue(undefined) };
    const port = new MqttAuthenticationPgGateway(pool, 'rpc');
    await expect(port.query('SELECT current_user', [])).rejects.toThrow('MQTT_AUTH_PG_QUERY_REJECTED');
    expect(pool.query).not.toHaveBeenCalled();
    await port.verifyPrivileges();
    await expect(port.query('DELETE FROM devices.mqtt_pairing_operation', [])).rejects.toThrow('MQTT_AUTH_PG_QUERY_REJECTED');
    expect(pool.query).toHaveBeenCalledTimes(1);
    await port.onModuleDestroy();
  });

  it('rechaza factory ante permisos distintos y siempre cierra el pool', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ ...validRow('rpc'), privileged: true }] }),
      end: jest.fn().mockResolvedValue(undefined) };
    const port = new MqttAuthenticationPgGateway(pool, 'rpc');
    await expect(port.verifyPrivileges()).rejects.toThrow('MQTT_AUTH_PG_PRIVILEGES_REJECTED');
    await expect(port.query('SELECT anything', [])).rejects.toThrow('MQTT_AUTH_PG_QUERY_REJECTED');
    await port.onModuleDestroy();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
