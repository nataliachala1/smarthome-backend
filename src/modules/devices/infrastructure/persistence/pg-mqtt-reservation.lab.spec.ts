import { Pool } from 'pg';
import { PgMqttReservationPort } from './pg-mqtt-reservation.port';

/**
 * Integration check against a DISPOSABLE local PostgreSQL container ONLY.
 * Never run on staging/production. Does not persist or alter application rows.
 */
const integrationEnabled = process.env.MQTT_RESERVER_RUN_LAB_TEST === 'true';
const suite = integrationEnabled ? describe : describe.skip;

suite('PgMqttReservationPort / laboratorio PostgreSQL aislado', () => {
  let pool: Pool;
  let databaseUrl: string;

  beforeAll(() => {
    databaseUrl = process.env.MQTT_RESERVER_DATABASE_URL ?? '';
    let url: URL;
    try {
      url = new URL(databaseUrl);
    } catch {
      throw new Error('MQTT_RESERVER_LAB_URL_MISSING');
    }
    if (
      process.env.NODE_ENV === 'production' ||
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

    pool = new Pool({
      connectionString: databaseUrl,
      ssl: false, // EXCLUSIVAMENTE localhost y base desechable.
      max: 1,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 1000,
      statement_timeout: 3000,
      query_timeout: 4000,
      application_name: 'smarthome_mqtt_reserver_lab_test',
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('rechaza una contraseña incorrecta (no confía en la red)', async () => {
    const incorrect = new URL(databaseUrl);
    incorrect.password = 'intentionally_wrong_password_for_lab_test';
    const probe = new Pool({
      connectionString: incorrect.toString(),
      ssl: false,
      max: 1,
      connectionTimeoutMillis: 3000,
    });
    try {
      await expect(probe.query('SELECT 1')).rejects.toThrow();
    } finally {
      await probe.end();
    }
  });

  it('confirma identidad y privilegios mínimos del LOGIN real', async () => {
    const result = await pool.query<{
      db: string;
      role: string;
      can_reserve: boolean;
      can_register: boolean;
      can_revoke: boolean;
      can_read_table: boolean;
      is_superuser: boolean;
      bypass_rls: boolean;
    }>(`
      SELECT current_database() AS db, current_user AS role,
        has_function_privilege(current_user,
          'devices.fn_reserve_mqtt_pairing_operation(uuid,text,uuid,text)',
          'EXECUTE') AS can_reserve,
        has_function_privilege(current_user,
          'devices.fn_register_mqtt_identity(uuid,uuid,text)',
          'EXECUTE') AS can_register,
        has_function_privilege(current_user,
          'devices.fn_claim_mqtt_revocation()',
          'EXECUTE') AS can_revoke,
        has_table_privilege(current_user,
          'devices.mqtt_pairing_operation', 'SELECT') AS can_read_table,
        r.rolsuper AS is_superuser,
        r.rolbypassrls AS bypass_rls
      FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
    `);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({
      db: 'smarthome_test',
      role: 'smarthome_mqtt_reserver_lab_login',
      can_reserve: true,
      can_register: false,
      can_revoke: false,
      can_read_table: false,
      is_superuser: false,
      bypass_rls: false,
    });
  });

  it('ejecuta el adaptador real y falla cerrado ante una sesión inexistente', async () => {
    const adapter = new PgMqttReservationPort(pool);
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
