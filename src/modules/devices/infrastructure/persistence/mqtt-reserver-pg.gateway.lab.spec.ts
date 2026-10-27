import { PgMqttReservationPort } from './pg-mqtt-reservation.port';
import {
  openMqttReserverPgGateway,
  type MqttReserverPgGateway,
} from './mqtt-reserver-pg.gateway';

/**
 * Prueba opt-in contra PostgreSQL desechable exclusivamente.
 * NO crea reservas reales, NO modifica bases DEV ni gestiona Mosquitto.
 */
const enabled = process.env.MQTT_RESERVER_RUN_LAB_TEST === 'true';
const suite = enabled ? describe : describe.skip;

suite('MqttReserverPgGateway / integración real de solo lectura', () => {
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

  it('verifica de verdad privilegios mínimos antes de permitir consultas', async () => {
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

  it('rechaza contraseña incorrecta con error genérico y sin revelar secretos', async () => {
    const wrongUrl = new URL(databaseUrl);
    wrongUrl.password = 'intentionally_invalid_lab_password';
    await expect(
      openMqttReserverPgGateway(wrongUrl.toString(), 'lab'),
    ).rejects.toThrow('MQTT_RESERVER_PRIVILEGES_UNVERIFIED');
  });

  it('encadena gateway real y adaptador, sin reservar una sesión inexistente', async () => {
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
