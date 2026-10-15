import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { MqttRuntimeService } from '../src/modules/devices/infrastructure/messaging/mqtt-runtime.service';
import {
  MqttRevocationResources,
  MqttRevocationRuntimeService,
} from '../src/modules/devices/infrastructure/messaging/mqtt-revocation-runtime.service';
import {
  assertMqttRevocationDatabase,
  MQTT_REVOCATION_DATABASE_AUDIT_SQL,
} from '../src/modules/devices/infrastructure/persistence/mqtt-revocation-database.audit';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { escapeLiteral, Pool, PoolClient } from 'pg';
import { connect, IClientOptions, MqttClient } from 'mqtt';
import { MqttRevocationWorker } from '../src/modules/devices/application/services/mqtt-revocation.worker';
import { PostgresMqttRevocationStore } from '../src/modules/devices/infrastructure/persistence/postgres-mqtt-revocation.store';
import { DeviceMqttPolicy } from '../src/modules/devices/infrastructure/messaging/identity/device-mqtt-policy';
import {
  BrokerAdminError,
  MosquittoAdminTransport,
} from '../src/modules/devices/infrastructure/messaging/identity/mosquitto-admin.transport';
import { MosquittoDeviceIdentityAdmin } from '../src/modules/devices/infrastructure/messaging/identity/mosquitto-device-identity.admin';

const suite = process.env.HU11_TEST_PG_CONTAINER ? describe : describe.skip;
suite('HU11 durable revocation: real PostgreSQL, RLS and Mosquitto TLS', () => {
  const owner = randomUUID(),
    member = randomUUID(),
    guest = randomUUID(),
    outsider = randomUUID();
  const home = randomUUID(),
    otherHome = randomUUID();
  const roles = [
    'app',
    'ingest',
    'readonly',
    'worker',
    'mqtt_registrar',
    'mqtt_revoke',
  ] as const;
  const pools: Pool[] = [];
  const logins = new Map<string, Pool>();
  const mqttClients: MqttClient[] = [];
  let admin: Pool;
  let store: PostgresMqttRevocationStore;
  let broker: MosquittoDeviceIdentityAdmin;
  let transport: MosquittoAdminTransport;
  let ca: Buffer;
  const contexts: TestingModule[] = [];
  const runtimePassword = randomBytes(32).toString('base64url');

  async function startRuntime() {
    const base = `127.0.0.1:${process.env.HU11_TEST_PG_PORT}/hu11_upgrade`;
    const password = encodeURIComponent(process.env.HU11_TEST_PG_PASSWORD!);
    const config = new ConfigService({
      NODE_ENV: 'test',
      MQTT_REVOCATION_ENABLED: 'true',
      MQTT_REVOCATION_POLL_MS: '250',
      DATABASE_URL: `postgresql://hu11_app:${password}@${base}`,
      DATABASE_IOT_URL: `postgresql://hu11_ingest:${password}@${base}`,
      DATABASE_MQTT_REVOKE_URL: `postgresql://hu11_mqtt_revoke:${password}@${base}`,
      MQTT_BROKER_URL: process.env.HU11_TEST_BROKER,
      MQTT_TLS_CA_FILE: process.env.HU11_TEST_CA,
      MQTT_TOPIC_NAMESPACE: 'smarthome/hu11-revocation/v1',
      MQTT_ADMIN_USERNAME: 'hu11-runtime-admin',
      MQTT_ADMIN_PASSWORD: runtimePassword,
      MQTT_ADMIN_CLIENT_ID: 'hu11-runtime-admin',
    });
    const context = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: config },
        MqttRuntimeService,
        MqttRevocationResources,
        MqttRevocationRuntimeService,
      ],
    })
      .setLogger({ log() {}, error() {}, warn() {} })
      .compile();
    contexts.push(context);
    await context.init();
    return { context, runtime: context.get(MqttRevocationRuntimeService) };
  }
  async function until(check: () => Promise<boolean>) {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error('HU11_RUNTIME_EXPECTATION_TIMEOUT');
  }

  function openMqtt(options: IClientOptions): Promise<MqttClient> {
    return new Promise((accept, reject) => {
      const client = connect(process.env.HU11_TEST_BROKER!, {
        protocolVersion: 5,
        clean: true,
        reconnectPeriod: 0,
        rejectUnauthorized: true,
        ca,
        connectTimeout: 2000,
        ...options,
      });
      mqttClients.push(client);
      const timeout = setTimeout(() => {
        client.end(true);
        reject(new Error('MQTT_TEST_TIMEOUT'));
      }, 3000);
      client.on('error', () => {});
      client.once('connect', () => {
        clearTimeout(timeout);
        accept(client);
      });
      client.once('error', () => {
        clearTimeout(timeout);
        client.end(true);
        reject(new Error('MQTT_TEST_CONNECTION_DENIED'));
      });
    });
  }

  async function withUser<T>(
    user: string,
    action: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await logins.get('app')!.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_user_id',$1,true)", [
        user,
      ]);
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function device(registered = true) {
    const id = randomUUID(),
      identity = randomUUID();
    const manufacturer = `shelly-revoke-${randomUUID()}`;
    await admin.query(
      `INSERT INTO devices.device(id_device,id_home,name,manufacturer_device_id,messaging_protocol)
      VALUES ($1::uuid,$2,$1::text,$3,'MQTT')`,
      [id, home, manufacturer],
    );
    const result = { id, identity, manufacturer };
    if (registered) await register(result);
    return result;
  }
  const register = (d: {
    id: string;
    identity: string;
    manufacturer: string;
  }) =>
    logins
      .get('mqtt_registrar')!
      .query('SELECT devices.fn_register_mqtt_identity($1,$2,$3) AS id', [
        d.id,
        d.identity,
        d.manufacturer,
      ]);
  const remove = (id: string, user = owner) =>
    withUser(user, (client) =>
      client.query(
        "UPDATE devices.device SET status='DEACTIVATED',deleted_at=clock_timestamp(),is_on=false,connectivity_status='OFFLINE' WHERE id_device=$1",
        [id],
      ),
    );
  const state = async (id: string) =>
    (
      await admin.query<{
        state: string;
        attempt_count: number;
        last_error_code: string | null;
        lease_token: string | null;
        revoked_at: Date | null;
      }>('SELECT * FROM devices.mqtt_identity WHERE id_mqtt_identity=$1', [id])
    ).rows[0];
  const expireLease = (id: string) =>
    admin.query(
      "UPDATE devices.mqtt_identity SET lease_until=clock_timestamp()-interval '1 second' WHERE id_mqtt_identity=$1",
      [id],
    );
  const dueNow = (id: string) =>
    admin.query(
      "UPDATE devices.mqtt_identity SET retry_at=clock_timestamp()-interval '1 second' WHERE id_mqtt_identity=$1",
      [id],
    );

  beforeAll(async () => {
    if (
      !/^smarthome-hu11-pg-[0-9a-f-]+$/.test(
        process.env.HU11_TEST_PG_CONTAINER!,
      )
    )
      throw new Error('Disposable PostgreSQL required');
    if (
      !/^mqtts:\/\/127\.0\.0\.1:\d+$/.test(process.env.HU11_TEST_BROKER ?? '')
    )
      throw new Error('Disposable TLS broker required');
    const caPath = resolve(process.env.HU11_TEST_CA!);
    if (!caPath.startsWith(resolve('.tmp') + sep))
      throw new Error('Temporary CA required');
    ca = readFileSync(caPath);
    const settings = {
      host: '127.0.0.1',
      port: Number(process.env.HU11_TEST_PG_PORT),
      database: 'hu11_upgrade',
      password: process.env.HU11_TEST_PG_PASSWORD,
      connectionTimeoutMillis: 2000,
      query_timeout: 5000,
    };
    admin = new Pool({ ...settings, user: 'postgres' });
    pools.push(admin);
    for (const role of roles) {
      // Role names are a fixed allowlist. Password is a temporary random value;
      // quote as a SQL literal and never print this DDL or raw errors containing it.
      await admin.query(
        `CREATE ROLE hu11_${role} LOGIN NOBYPASSRLS NOSUPERUSER IN ROLE smarthome_${role} PASSWORD ${escapeLiteral(settings.password!)}`,
      );
      const pool = new Pool({ ...settings, user: `hu11_${role}` });
      pools.push(pool);
      logins.set(role, pool);
    }
    for (const user of [owner, member, guest, outsider])
      await admin.query(
        "INSERT INTO auth.\"user\"(id_user,name,email,password_hash,status) VALUES ($1::uuid,$1::text,$2,'fixture','ACTIVE')",
        [user, `${user}@example.invalid`],
      );
    await admin.query(
      "INSERT INTO homes.home(id_home,created_by,name) VALUES ($1,$2,'A'),($3,$4,'B')",
      [home, owner, otherHome, outsider],
    );
    for (const [user, role, homeId] of [
      [owner, 'OWNER', home],
      [member, 'MEMBER', home],
      [guest, 'GUEST', home],
      [outsider, 'OWNER', otherHome],
    ]) {
      await admin.query(
        "INSERT INTO homes.home_member(id_home,id_user,role,status,accepted_at) VALUES ($1,$2,$3,'ACTIVE',now())",
        [homeId, user, role],
      );
    }
    store = new PostgresMqttRevocationStore(logins.get('mqtt_revoke')!);
    const client = await openMqtt({
      username: 'hu11-fixture-admin',
      password: process.env.HU11_TEST_ADMIN_PASSWORD,
      clientId: 'hu11-fixture-admin',
    });
    transport = new MosquittoAdminTransport(client);
    broker = new MosquittoDeviceIdentityAdmin(
      transport,
      new DeviceMqttPolicy('smarthome/hu11-revocation/v1'),
    );
    await transport.execute({
      command: 'createRole',
      rolename: 'hu11-runtime-admin-role',
      acls: [
        {
          acltype: 'publishClientSend',
          topic: '$CONTROL/dynamic-security/v1',
          allow: true,
          priority: 0,
        },
        {
          acltype: 'publishClientReceive',
          topic: '$CONTROL/dynamic-security/v1/response',
          allow: true,
          priority: 0,
        },
        {
          acltype: 'subscribeLiteral',
          topic: '$CONTROL/dynamic-security/v1/response',
          allow: true,
          priority: 0,
        },
      ],
    });
    await transport.execute({
      command: 'createClient',
      username: 'hu11-runtime-admin',
      clientid: 'hu11-runtime-admin',
      password: runtimePassword,
      roles: [{ rolename: 'hu11-runtime-admin-role', priority: 0 }],
    });
  });

  beforeEach(async () => {
    await admin.query('TRUNCATE devices.mqtt_identity');
  });
  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close();
  });
  afterAll(async () => {
    transport?.close();
    await Promise.all(
      mqttClients.map(
        (client) =>
          new Promise<void>((done) => client.end(true, {}, () => done())),
      ),
    );
    await Promise.all(pools.map((pool) => pool.end()));
  });

  it('keeps the runtime audit identical to the database read-only script', () => {
    const sql = readFileSync(
      resolve(
        process.env.HU11_TEST_DATABASE_REPO!,
        'scripts/audit-mqtt-revocation.sql',
      ),
      'utf8',
    );
    expect(
      MQTT_REVOCATION_DATABASE_AUDIT_SQL.trim().replace(/\r\n/g, '\n'),
    ).toBe(sql.trim().replace(/\r\n/g, '\n'));
  });

  it('accepts only the isolated revocation login in the runtime audit', async () => {
    await expect(
      assertMqttRevocationDatabase(logins.get('mqtt_revoke')!),
    ).resolves.toBeUndefined();
    await expect(assertMqttRevocationDatabase(admin)).rejects.toThrow(
      'DATABASE_UNSAFE',
    );
  });

  it.each(['app', 'ingest', 'readonly', 'worker', 'mqtt_registrar'])(
    'refuses runtime startup privileges of %s',
    async (role) => {
      await expect(
        assertMqttRevocationDatabase(logins.get(role)!),
      ).rejects.toThrow('DATABASE_UNSAFE');
    },
  );

  it('detects a direct column privilege that bypasses role isolation', async () => {
    await admin.query(
      'GRANT SELECT(id_mqtt_identity) ON devices.mqtt_identity TO hu11_mqtt_revoke',
    );
    try {
      await expect(
        assertMqttRevocationDatabase(logins.get('mqtt_revoke')!),
      ).rejects.toThrow('DATABASE_UNSAFE');
    } finally {
      await admin.query(
        'REVOKE SELECT(id_mqtt_identity) ON devices.mqtt_identity FROM hu11_mqtt_revoke',
      );
    }
  });

  it('detects accidental PUBLIC execution of an administrative function', async () => {
    await admin.query(
      'GRANT EXECUTE ON FUNCTION devices.fn_finish_mqtt_revocation(uuid,uuid,text) TO PUBLIC',
    );
    try {
      await expect(
        assertMqttRevocationDatabase(logins.get('mqtt_revoke')!),
      ).rejects.toThrow('DATABASE_UNSAFE');
    } finally {
      await admin.query(
        'REVOKE EXECUTE ON FUNCTION devices.fn_finish_mqtt_revocation(uuid,uuid,text) FROM PUBLIC',
      );
    }
  });

  it('does not accept a privileged session hidden behind SET ROLE', async () => {
    const client = await admin.connect();
    try {
      await client.query('SET ROLE smarthome_mqtt_revoke');
      const rows = await client.query<{ check_name: string; passed: boolean }>(
        MQTT_REVOCATION_DATABASE_AUDIT_SQL,
      );
      expect(
        rows.rows.find((row) => row.check_name === 'exact_runtime_login')
          ?.passed,
      ).toBe(false);
      expect(
        rows.rows.find((row) => row.check_name === 'nonprivileged_roles')
          ?.passed,
      ).toBe(false);
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  });

  it('rejects a definer function without its pinned search_path', async () => {
    await admin.query(
      'ALTER FUNCTION devices.fn_claim_mqtt_revocation() RESET search_path',
    );
    try {
      await expect(
        assertMqttRevocationDatabase(logins.get('mqtt_revoke')!),
      ).rejects.toThrow('DATABASE_UNSAFE');
    } finally {
      await admin.query(
        'ALTER FUNCTION devices.fn_claim_mqtt_revocation() SET search_path TO pg_catalog, pg_temp',
      );
    }
  });

  it('processes a durable job automatically through Nest lifecycle and closes its database connection', async () => {
    const d = await device(false);
    await broker.provision(d.identity, d.manufacturer);
    await register(d);
    await remove(d.id);
    const { context, runtime } = await startRuntime();
    await until(async () => (await state(d.identity)).state === 'REVOKED');
    await context.close();
    expect(runtime.status()).toMatchObject({ running: false, completed: 1 });
    expect(
      (
        await admin.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='smarthome-mqtt-revocation'",
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('recovers automatically with a new broker session after administrative login is restored', async () => {
    const d = await device(false);
    await broker.provision(d.identity, d.manufacturer);
    await register(d);
    await remove(d.id);
    await transport.execute({
      command: 'disableClient',
      username: 'hu11-runtime-admin',
    });
    try {
      await startRuntime();
      await until(
        async () =>
          (await state(d.identity)).last_error_code ===
          'MQTT_ADMIN_UNAVAILABLE',
      );
      expect((await state(d.identity)).state).toBe('REVOKE_PENDING');
      await transport.execute({
        command: 'enableClient',
        username: 'hu11-runtime-admin',
      });
      await dueNow(d.identity);
      await until(async () => (await state(d.identity)).state === 'REVOKED');
      expect((await state(d.identity)).attempt_count).toBeGreaterThanOrEqual(2);
    } finally {
      await transport.execute({
        command: 'enableClient',
        username: 'hu11-runtime-admin',
      });
    }
  });

  it('suspends claims after a role change and resumes after permissions are repaired', async () => {
    const { runtime } = await startRuntime();
    await until(() => Promise.resolve(runtime.status().lastEvent === 'IDLE'));
    await admin.query('GRANT smarthome_ingest TO hu11_mqtt_revoke');
    try {
      await until(() =>
        Promise.resolve(
          runtime.status().lastEvent === 'MQTT_REVOCATION_DATABASE_UNSAFE',
        ),
      );
      const d = await device(false);
      await broker.provision(d.identity, d.manufacturer);
      await register(d);
      await remove(d.id);
      expect((await state(d.identity)).attempt_count).toBe(0);
      await admin.query('REVOKE smarthome_ingest FROM hu11_mqtt_revoke');
      await until(async () => (await state(d.identity)).state === 'REVOKED');
    } finally {
      await admin.query('REVOKE smarthome_ingest FROM hu11_mqtt_revoke');
    }
  });

  it.each(roles)(
    'uses an actual %s login without superuser/BYPASSRLS or administrative membership',
    async (role) => {
      const result = await logins.get(role)!.query<{
        safe: boolean;
      }>(`SELECT NOT rolsuper AND NOT rolbypassrls
      AND NOT pg_has_role(current_user, 'smarthome_admin', 'MEMBER') AS safe FROM pg_roles WHERE rolname=current_user`);
      expect(result.rows[0].safe).toBe(true);
    },
  );

  it.each(roles)('forbids direct metadata access by %s', async (role) => {
    await expect(
      logins.get(role)!.query('SELECT * FROM devices.mqtt_identity'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it.each(['app', 'ingest', 'readonly', 'worker', 'mqtt_registrar'])(
    'forbids administrative claim by %s',
    async (role) => {
      await expect(
        logins
          .get(role)!
          .query('SELECT * FROM devices.fn_claim_mqtt_revocation()'),
      ).rejects.toMatchObject({ code: '42501' });
    },
  );

  it('does not let the revocation worker register or change a binding', async () => {
    await expect(
      logins
        .get('mqtt_revoke')!
        .query('SELECT devices.fn_register_mqtt_identity($1,$2,$3)', [
          randomUUID(),
          randomUUID(),
          'shelly-test',
        ]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('registers once, retries the same reference and rejects replacement', async () => {
    const d = await device();
    expect((await register(d)).rows[0]).toEqual({ id: d.identity });
    await expect(
      register({ ...d, identity: randomUUID() }),
    ).rejects.toMatchObject({ code: '23505' });
    expect(await state(d.identity)).toMatchObject({
      state: 'REGISTERED',
      attempt_count: 0,
    });
    expect(await store.claim()).toBeNull();
  });

  it('rejects late registration after logical deletion', async () => {
    const d = await device(false);
    await remove(d.id);
    await expect(register(d)).rejects.toMatchObject({ code: '23514' });
  });

  it('never re-registers a pending/revoked identity even if the device row is restored', async () => {
    const d = await device();
    await remove(d.id);
    await admin.query(
      "UPDATE devices.device SET status='ACTIVE',deleted_at=NULL WHERE id_device=$1",
      [d.id],
    );
    await expect(register(d)).rejects.toMatchObject({
      code: '23514',
      message: 'MQTT_IDENTITY_REVOCATION_TERMINAL',
    });
    const claim = (await store.claim())!;
    expect(await store.finish(claim, null)).toBe(true);
    await expect(register(d)).rejects.toMatchObject({
      code: '23514',
      message: 'MQTT_IDENTITY_REVOCATION_TERMINAL',
    });
    expect((await state(d.identity)).state).toBe('REVOKED');
  });

  it('rejects manufacturer mismatch, missing device, and non-v4 identity', async () => {
    const d = await device(false);
    await expect(
      register({ ...d, manufacturer: 'another-device' }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(register({ ...d, id: randomUUID() })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      register({ ...d, identity: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps manufacturer globally reserved, including after deletion', async () => {
    const d = await device();
    await remove(d.id);
    await expect(
      admin.query(
        'INSERT INTO devices.device(id_home,name,manufacturer_device_id) VALUES ($1,$2,$3)',
        [otherHome, randomUUID(), d.manufacturer],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      admin.query(
        'UPDATE devices.device SET manufacturer_device_id=$1 WHERE id_device=$2',
        ['replacement', d.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      admin.query('UPDATE devices.device SET id_home=$1 WHERE id_device=$2', [
        otherHome,
        d.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it.each([
    ['MEMBER', member],
    ['GUEST', guest],
    ['other OWNER', outsider],
  ])(
    '%s cannot request revocation by deleting the device',
    async (_role, user) => {
      const d = await device();
      try {
        expect((await remove(d.id, user)).rowCount).toBe(0);
      } catch (error) {
        expect(error).toMatchObject({ code: '42501' });
      }
      expect((await state(d.identity)).state).toBe('REGISTERED');
    },
  );

  it('rolls back revocation together with a failed business transaction', async () => {
    const d = await device();
    await expect(
      withUser(owner, async (client) => {
        await client.query(
          "UPDATE devices.device SET status='DEACTIVATED',deleted_at=now() WHERE id_device=$1",
          [d.id],
        );
        throw new Error('simulated later transaction failure');
      }),
    ).rejects.toThrow('simulated later transaction failure');
    expect((await state(d.identity)).state).toBe('REGISTERED');
    expect(
      (
        await admin.query<{ deleted_at: Date | null }>(
          'SELECT deleted_at FROM devices.device WHERE id_device=$1',
          [d.id],
        )
      ).rows[0].deleted_at,
    ).toBeNull();
  });

  it('serializes registration against device deletion on the same row lock', async () => {
    const d = await device(false);
    const registrar = await logins.get('mqtt_registrar')!.connect();
    try {
      await registrar.query('BEGIN');
      await registrar.query(
        'SELECT devices.fn_register_mqtt_identity($1,$2,$3)',
        [d.id, d.identity, d.manufacturer],
      );
      await expect(
        withUser(owner, async (client) => {
          await client.query("SET LOCAL lock_timeout='100ms'");
          await client.query(
            "UPDATE devices.device SET status='DEACTIVATED',deleted_at=now() WHERE id_device=$1",
            [d.id],
          );
        }),
      ).rejects.toMatchObject({ code: '55P03' });
      await registrar.query('COMMIT');
    } finally {
      await registrar.query('ROLLBACK');
      registrar.release();
    }
    await remove(d.id);
    expect((await state(d.identity)).state).toBe('REVOKE_PENDING');
  });

  it('assigns different jobs concurrently and does not double claim', async () => {
    const a = await device(),
      b = await device();
    await remove(a.id);
    await remove(b.id);
    const claims = await Promise.all([store.claim(), store.claim()]);
    expect(new Set(claims.map((claim) => claim!.identityId))).toEqual(
      new Set([a.identity, b.identity]),
    );
    expect(await store.claim()).toBeNull();
  });

  it('skips a row locked by another worker', async () => {
    const a = await device(),
      b = await device();
    await remove(a.id);
    await remove(b.id);
    const locked = await admin.connect();
    try {
      await locked.query('BEGIN');
      await locked.query(
        'SELECT 1 FROM devices.mqtt_identity WHERE id_mqtt_identity=$1 FOR UPDATE',
        [a.identity],
      );
      expect((await store.claim())?.identityId).toBe(b.identity);
    } finally {
      await locked.query('ROLLBACK');
      locked.release();
    }
  });

  it('recovers an expired lease and rejects old/wrong/expired completions', async () => {
    const d = await device();
    await remove(d.id);
    const old = (await store.claim())!;
    await expireLease(d.identity);
    expect(await store.finish(old, null)).toBe(false);
    const current = (await store.claim())!;
    expect(current.claimToken).not.toBe(old.claimToken);
    expect(current.attempt).toBe(2);
    expect(await store.finish(old, null)).toBe(false);
    expect(
      await store.finish({ ...current, claimToken: randomUUID() }, null),
    ).toBe(false);
    expect(await store.finish(current, null)).toBe(true);
    expect(await store.finish(current, null)).toBe(false);
  });

  it('keeps an uncertain broker outcome pending and delays the next attempt', async () => {
    const d = await device();
    await remove(d.id);
    const worker = new MqttRevocationWorker(store, {
      revoke: () =>
        Promise.reject(new BrokerAdminError('MQTT_ADMIN_OUTCOME_UNKNOWN')),
    });
    expect(await worker.runOnce()).toBe('RETRY_SCHEDULED');
    expect(await state(d.identity)).toMatchObject({
      state: 'REVOKE_PENDING',
      last_error_code: 'MQTT_ADMIN_OUTCOME_UNKNOWN',
      revoked_at: null,
      lease_token: null,
    });
    expect(await store.claim()).toBeNull();
    await dueNow(d.identity);
    expect((await store.claim())?.attempt).toBe(2);
  });

  it('rejects arbitrary error payloads in persistence', async () => {
    const d = await device();
    await remove(d.id);
    const claim = (await store.claim())!;
    await expect(
      logins
        .get('mqtt_revoke')!
        .query('SELECT devices.fn_finish_mqtt_revocation($1,$2,$3)', [
          d.identity,
          claim.claimToken,
          'password=DO_NOT_STORE',
        ]),
    ).rejects.toMatchObject({ code: '22023' });
    expect((await state(d.identity)).last_error_code).toBeNull();
  });

  it('keeps repeated logical updates from resetting an in-flight lease', async () => {
    const d = await device();
    await remove(d.id);
    const claim = (await store.claim())!;
    await remove(d.id);
    expect((await state(d.identity)).lease_token).toBe(claim.claimToken);
  });

  it('keeps the existing deactivate/reactivate flow separate from unlinking', async () => {
    const d = await device();
    await withUser(owner, (client) =>
      client.query(
        "UPDATE devices.device SET status='DEACTIVATED' WHERE id_device=$1",
        [d.id],
      ),
    );
    expect((await state(d.identity)).state).toBe('REGISTERED');
  });

  it('refuses rollback while the registry contains references', async () => {
    await device();
    const sql = readFileSync(
      resolve(
        process.env.HU11_TEST_DATABASE_REPO!,
        'releases/011_mqtt_revocation/mqtt-revocation.rollback.sql',
      ),
      'utf8',
    );
    await expect(admin.query(sql)).rejects.toThrow(
      'MQTT_IDENTITY_ROLLBACK_REQUIRES_EMPTY_REGISTRY',
    );
    expect(
      (
        await admin.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM devices.mqtt_identity',
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('has RLS enabled, no secret columns and no PUBLIC administrative execute grants', async () => {
    const columns = (
      await admin.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='devices' AND table_name='mqtt_identity'",
      )
    ).rows.map((row) => row.column_name);
    expect(
      columns.some((column) => /password|secret|verifier/.test(column)),
    ).toBe(false);
    expect(
      (
        await admin.query<{ relrowsecurity: boolean }>(
          "SELECT relrowsecurity FROM pg_class WHERE oid='devices.mqtt_identity'::regclass",
        )
      ).rows[0].relrowsecurity,
    ).toBe(true);
    const grants =
      await admin.query(`SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
      WHERE p.pronamespace='devices'::regnamespace AND p.proname IN
      ('fn_register_mqtt_identity','fn_claim_mqtt_revocation','fn_finish_mqtt_revocation','fn_mqtt_identity_device_update')
      AND a.grantee=0 AND a.privilege_type='EXECUTE'`);
    expect(grants.rowCount).toBe(0);
  });

  it('revokes a connected real client after OWNER deletion and preserves historical rows', async () => {
    const d = await device(false);
    const issued = await broker.provision(d.identity, d.manufacturer);
    await register(d);
    const live = await openMqtt({
      username: issued.identity.username,
      password: issued.password,
      clientId: issued.identity.clientId,
    });
    await admin.query(
      'INSERT INTO consumption.consumption(id_device,id_home,power_w,energy_delta_kwh) VALUES ($1,$2,10,0.01)',
      [d.id, home],
    );
    await admin.query(
      "INSERT INTO devices.device_telemetry_raw(id_device,payload) VALUES ($1,'{}')",
      [d.id],
    );
    await admin.query(
      "INSERT INTO consumption.consumption_metric(id_device,id_home,period,start_at,end_at,kwh_total) VALUES ($1,$2,'dia',now()-interval '1 day',now(),0.01)",
      [d.id, home],
    );
    const alert = randomUUID();
    await admin.query(
      "INSERT INTO notifications.alert(id_alert,id_device,id_home,alert_type) VALUES ($1,$2,$3,'DEVICE_EVENT')",
      [alert, d.id, home],
    );
    await admin.query(
      "INSERT INTO notifications.notification(id_user,id_alert,id_home,id_device,type,title,message) VALUES ($1,$2,$3,$4,'ALERT','Fixture','Fixture')",
      [owner, alert, home, d.id],
    );
    await admin.query(
      "INSERT INTO identity_audit.audit_log(id_home,action,module,id_entity) VALUES ($1,'FIXTURE','devices',$2)",
      [home, d.id],
    );
    const snapshot = async () => {
      const result = await admin.query<{ content: string }>(
        `SELECT md5(jsonb_build_array(
        (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id_consumption,c.read_at) FROM consumption.consumption c WHERE id_device=$1),
        (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id_consumption_metric) FROM consumption.consumption_metric m WHERE id_device=$1),
        (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id_device_telemetry_raw) FROM devices.device_telemetry_raw t WHERE id_device=$1),
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id_alert) FROM notifications.alert a WHERE id_device=$1),
        (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.id_notification) FROM notifications.notification n WHERE id_device=$1),
        (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id_audit_log) FROM identity_audit.audit_log l WHERE id_entity=$1)
      )::text) AS content`,
        [d.id],
      );
      return result.rows[0].content;
    };
    const before = await snapshot();
    await remove(d.id);
    expect((await state(d.identity)).state).toBe('REVOKE_PENDING');
    expect(live.connected).toBe(true);
    const disconnected = new Promise<void>((accept, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Revocation did not disconnect client')),
        2000,
      );
      live.once('close', () => {
        clearTimeout(timer);
        accept();
      });
    });
    expect(await new MqttRevocationWorker(store, broker).runOnce()).toBe(
      'REVOKED',
    );
    await disconnected;
    expect((await state(d.identity)).state).toBe('REVOKED');
    await expect(
      openMqtt({
        username: issued.identity.username,
        password: issued.password,
        clientId: issued.identity.clientId,
      }),
    ).rejects.toThrow('MQTT_TEST_CONNECTION_DENIED');
    expect(await snapshot()).toBe(before);
    expect(await new MqttRevocationWorker(store, broker).runOnce()).toBe(
      'IDLE',
    );
  });

  it('recovers broker success followed by loss of the database completion', async () => {
    const d = await device(false);
    await broker.provision(d.identity, d.manufacturer);
    await register(d);
    await remove(d.id);
    const uncertainStore = {
      claim: () => store.claim(),
      finish: () => Promise.reject(new Error('simulated database outage')),
    };
    await expect(
      new MqttRevocationWorker(uncertainStore, broker).runOnce(),
    ).rejects.toThrow('MQTT_REVOCATION_STORE_UNAVAILABLE');
    expect((await state(d.identity)).state).toBe('REVOKE_PENDING');
    await expireLease(d.identity);
    expect(await new MqttRevocationWorker(store, broker).runOnce()).toBe(
      'REVOKED',
    );
    expect((await state(d.identity)).attempt_count).toBe(2);
  });

  it('does not mark a missing broker identity revoked after a negative administrative response', async () => {
    const d = await device();
    await remove(d.id);
    expect(await new MqttRevocationWorker(store, broker).runOnce()).toBe(
      'RETRY_SCHEDULED',
    );
    expect(await state(d.identity)).toMatchObject({
      state: 'REVOKE_PENDING',
      last_error_code: 'MQTT_ADMIN_REJECTED',
      revoked_at: null,
    });
  });
});
