import { parseMqttSecretConnection, parseMqttSecretDevConnection } from './mqtt-secret-pg.gateway';

describe('MQTT secret VPS DEV - TLS and role isolation', () => {
  const host = 'smart-home-smarthomepostgresdev-vrmtpz';
  const password = 'A'.repeat(43); // synthetic marker; never use a real key
  const mk = (role = 'smarthome_mqtt_secret_dev_login', db = 'smarthome_dev', server = host) =>
    `postgresql://${role}:${password}@${server}:5432/${db}`;

  it('allows the secret account exclusively on verified VPS DEV TLS', () => {
    const target = parseMqttSecretConnection(mk(), 'vps-dev-tls', 'production');
    expect(target.role).toBe('smarthome_mqtt_secret_dev_login');
    expect(target.database).toBe('smarthome_dev');
    expect(target.options.ssl).toEqual({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
  });
  it('rechaza roles ajenos, base diferente y servidor equivocado', () => {
    expect(() => parseMqttSecretConnection(mk('smarthome_mqtt_auth_dev_login'), 'vps-dev-tls', 'production')).toThrow('MQTT_SECRET_DATABASE_TARGET_NOT_ALLOWED');
    expect(() => parseMqttSecretConnection(mk(undefined, 'smarthome'), 'vps-dev-tls', 'production')).toThrow('MQTT_SECRET_DATABASE_TARGET_NOT_ALLOWED');
    expect(() => parseMqttSecretConnection(mk(undefined, undefined, '127.0.0.1'), 'vps-dev-tls', 'production')).toThrow('MQTT_SECRET_DATABASE_TARGET_NOT_ALLOWED');
  });
  it('rechaza TLS alterable via parametros, modo equivocado o entorno diferente', () => {
    expect(() => parseMqttSecretConnection(`${mk()}?sslmode=disable`, 'vps-dev-tls', 'production')).toThrow('MQTT_SECRET_DATABASE_TARGET_NOT_ALLOWED');
    expect(() => parseMqttSecretConnection(mk(), 'local-dev', 'production')).toThrow('MQTT_SECRET_DATABASE_TARGET_NOT_ALLOWED');
    expect(() => parseMqttSecretConnection(mk(), 'vps-dev-tls', 'development')).toThrow('MQTT_SECRET_DATABASE_TARGET_NOT_ALLOWED');
  });
  it('keeps local-dev without TLS only in local development', () => {
    const local = mk(undefined, 'smarthome', '127.0.0.1');
    expect(parseMqttSecretDevConnection(local, 'development').options.ssl).toBe(false);
    expect(() => parseMqttSecretDevConnection(local, 'production')).toThrow('MQTT_SECRET_DATABASE_TARGET_NOT_ALLOWED');
  });
});
