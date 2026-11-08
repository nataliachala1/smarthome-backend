import { PgMqttReservationPort } from './pg-mqtt-reservation.port';
import {
  openMqttReserverPgGateway,
  type MqttReserverPgGateway,
} from './mqtt-reserver-pg.gateway';

/**
 * Opt-in test exclusively against a disposable PostgreSQL.
 * It does NOT create real reservations, modify DEV databases or manage Mosquitto.
 */
const enabled = process.env.MQTT_RESERVER_RUN_LAB_TEST === 'true';
const suite = enabled ? describe : describe.skip;

suite('MqttReserverPgGateway / real read-only integration', () => {
  let databaseUrl: string;

  beforeAll(() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MQTT_RESERVER_LAB_NOT_ALLOWED_IN_PRODUCTION');
    }
    databaseUrl = process.env.MQTT_RESERVER_DATABASE_URL ?? '';
    let url: URL;
    try {
      url = new URL(databaseUrl);
    } catch {
      throw new Error('MQTT_RESERVER_LAB_URL_MISSING');
    }
    if (
      url.protocol !== 'postgresql:' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '55432' ||
      url.pathname !== '/smarthome_test' ||
      url.username !== 'smarthome_mqtt_reserver_lab_login' ||
      !url.password ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new Error('MQTT_RESERVER_LAB_TARGET_NOT_ALLOWED');
    }
  });

  async function withGateway(
    test: (gateway: MqttReserverPgGateway) => Promise<void>,
  ): Promise<void> {
    const gateway = await openMqttReserverPgGateway(databaseUrl, 'lab');
    try {
      await test(gateway);
    } finally {
      await gateway.onModuleDestroy();
    }
  }

  it('really verifies minimum privileges before allowing queries', async () => {
    await withGateway(async (gateway) => {
      const response = await gateway.query(
        'SELECT current_user::text AS username, current_database()::text AS database',
        [],
      );
      expect(response.rows).toEqual([
        {
          username: 'smarthome_mqtt_reserver_lab_login',
          database: 'smarthome_test',
        },
      ]);
    });
  });

  it('rejects a wrong password with a generic error and without revealing secrets', async () => {
    const wrongUrl = new URL(databaseUrl);
    wrongUrl.password = 'intentionally_invalid_lab_password';
    await expect(
      openMqttReserverPgGateway(wrongUrl.toString(), 'lab'),
    ).rejects.toThrow('MQTT_RESERVER_PRIVILEGES_UNVERIFIED');
  });

  it('chains the real gateway and adapter without reserving a non-existent session', async () => {
    await withGateway(async (gateway) => {
      const adapter = new PgMqttReservationPort(gateway);
      await expect(
        adapter.reserve(
          '00000000-0000-4000-8000-000000000001',
          'smarthome/devices/shelly1pmg4-test',
          '00000000-0000-4000-8000-000000000002',
          'a'.repeat(64),
        ),
      ).rejects.toThrow('MQTT_REGISTRAR_RESERVATION_FAILED');
    });
  });
});
