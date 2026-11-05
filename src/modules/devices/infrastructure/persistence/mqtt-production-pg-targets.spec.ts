import { parseMqttAuthPgConnection } from './mqtt-authentication-pg.gateway';
import { parseMqttRevocationConnection } from './mqtt-revocation-pg.gateway';
import { parseMqttReserverConnection } from './mqtt-reserver-pg.gateway';
import { parseMqttSecretConnection } from './mqtt-secret-pg.gateway';
import { parseMqttWorkerConnection } from './mqtt-worker-pg.gateway';

const password = 'P'.repeat(43);
const url = (role: string, database = 'smarthome', host = 'postgres-prod.example.com') =>
  `postgresql://${role}:${password}@${host}:5432/${database}`;

describe('MQTT production PostgreSQL login isolation', () => {
  it('requires an isolated production reserver with verified TLS', () => {
    const target = parseMqttReserverConnection(
      url('smarthome_mqtt_reserver_prod_login'), 'production', 'production',
    );
    expect(target.role).toBe('smarthome_mqtt_reserver_prod_login');
    expect(target.options.ssl).toMatchObject({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    expect(() => parseMqttReserverConnection(
      url('smarthome_mqtt_reserver_dev_login'), 'production', 'production',
    )).toThrow('MQTT_RESERVER_DATABASE_TARGET_NOT_ALLOWED');
  });

  it.each([
    ['lease', 'smarthome_mqtt_lease_prod_login'],
    ['confirmer', 'smarthome_mqtt_confirmer_prod_login'],
  ] as const)('requires the dedicated %s worker login', (kind, role) => {
    const target = parseMqttWorkerConnection(
      url(role), kind, 'production', 'production',
    );
    expect(target.role).toBe(role);
    expect(target.options.ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it('uses a separate production secret login and verified TLS', () => {
    expect(parseMqttSecretConnection(
      url('smarthome_mqtt_secret_prod_login'), 'production', 'production',
    ).options.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(() => parseMqttSecretConnection(
      url('smarthome_mqtt_secret_prod_login', 'smarthome_dev'),
      'production', 'production',
    )).toThrow('MQTT_SECRET_DATABASE_TARGET_NOT_ALLOWED');
  });

  it.each([
    ['rpc', 'smarthome_mqtt_rpc_prod_login'],
    ['confirm', 'smarthome_mqtt_auth_prod_login'],
  ] as const)('uses a separate production %s authentication login', (kind, role) => {
    const target = parseMqttAuthPgConnection(
      url(role), kind, 'production', 'production',
    );
    expect(target.role).toBe(role);
    expect(target.options.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(() => parseMqttAuthPgConnection(
      url(role), kind, 'production', 'development',
    )).toThrow('MQTT_AUTH_PG_TARGET_NOT_ALLOWED');
  });

  it('requires a separate revocation login and rejects DEV hosts', () => {
    const target = parseMqttRevocationConnection(
      url('smarthome_mqtt_revoke_prod_login'), 'production', 'production',
    );
    expect(target.role).toBe('smarthome_mqtt_revoke_prod_login');
    expect(target.options.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(() => parseMqttRevocationConnection(
      url('smarthome_mqtt_revoke_prod_login', 'smarthome', 'smart-home-smarthomepostgresdev-vrmtpz'),
      'production', 'production',
    )).toThrow('MQTT_REVOCATION_DATABASE_TARGET_NOT_ALLOWED');
  });

  it.each(['127.0.0.2', '[::1]', '0.0.0.0'])('rejects loopback database host %s', (host) => {
    expect(() => parseMqttReserverConnection(
      url('smarthome_mqtt_reserver_prod_login', 'smarthome', host),
      'production', 'production',
    )).toThrow('MQTT_RESERVER_DATABASE_TARGET_NOT_ALLOWED');
  });
});
