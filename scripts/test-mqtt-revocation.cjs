// Disposable PostgreSQL + Liquibase + TLS Mosquitto. Never reads .env.
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const { Pool } = require('pg');
const root = path.resolve(__dirname, '..');
const database = path.resolve(
  process.argv[2] || path.join(root, 'smarthome-database'),
);
const container = `smarthome-hu11-pg-${randomUUID()}`;
const password = randomBytes(32).toString('base64url');
const pools = [];
let created = false;
let phase = 'preflight';
function command(program, args, env = {}) {
  return execFileSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000,
    windowsHide: true,
    env: { ...process.env, ...env },
  });
}
function migrate(db, changelog, action, extra = []) {
  command(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      `container:${container}`,
      '--label',
      'smarthome.test=hu11-revocation',
      '--mount',
      `type=bind,source=${database},target=/liquibase/changelog,readonly`,
      '--env',
      'LIQUIBASE_COMMAND_PASSWORD',
      'liquibase/liquibase:4.29',
      '--search-path=/liquibase/changelog',
      `--changelog-file=${changelog}`,
      `--url=jdbc:postgresql://127.0.0.1:5432/${db}`,
      '--username=postgres',
      action,
      ...extra,
    ],
    { LIQUIBASE_COMMAND_PASSWORD: password },
  );
}
async function main() {
  command('docker', ['image', 'inspect', 'postgres:16-alpine']);
  command('docker', ['image', 'inspect', 'liquibase/liquibase:4.29']);
  phase = 'disposable PostgreSQL';
  command(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      container,
      '--label',
      'smarthome.test=hu11-revocation',
      '--publish',
      '127.0.0.1::5432',
      '--tmpfs',
      '/var/lib/postgresql/data:rw,size=268435456',
      '--env',
      'POSTGRES_PASSWORD',
      'postgres:16-alpine',
    ],
    { POSTGRES_PASSWORD: password },
  );
  created = true;
  const match = /^127\.0\.0\.1:(\d+)$/.exec(
    command('docker', ['port', container, '5432/tcp']).trim(),
  );
  if (!match) throw new Error('Expected loopback-only PostgreSQL');
  const settings = {
    host: '127.0.0.1',
    port: Number(match[1]),
    user: 'postgres',
    password,
    connectionTimeoutMillis: 2000,
    query_timeout: 10000,
  };
  const admin = new Pool({ ...settings, database: 'postgres' });
  pools.push(admin);
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt++) {
    try {
      await admin.query('SELECT 1');
      ready = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) throw new Error('Disposable PostgreSQL not ready');
  await admin.query('CREATE DATABASE hu11_clean');
  await admin.query('CREATE DATABASE hu11_upgrade');
  const upgrade = new Pool({ ...settings, database: 'hu11_upgrade' });
  pools.push(upgrade);
  const master = 'changelog/changelog-master.yaml';
  phase = 'Liquibase clean migration';
  migrate('hu11_clean', master, 'validate');
  migrate('hu11_clean', master, 'update');
  console.log('PASS: Liquibase clean update and validation.');
  phase = 'Liquibase empty-registry rollback and reapply';
  migrate('hu11_clean', master, 'rollback-count', ['--count=2']);
  migrate('hu11_clean', master, 'update');
  console.log('PASS: empty-registry rollback and reapply.');
  phase = 'Liquibase baseline';
  migrate('hu11_upgrade', 'tests/mqtt/hu10-baseline.yaml', 'update');
  const before = (
    await upgrade.query(
      'SELECT id, md5sum FROM databasechangelog ORDER BY orderexecuted',
    )
  ).rows;
  // Existing business row before the incremental migration; no artificial bootstrap.
  await upgrade.query(`INSERT INTO auth."user"(id_user,name,email,password_hash,status)
    VALUES ('11111111-1111-4111-8111-111111111111','Fixture','upgrade@example.invalid','fixture','ACTIVE');
    INSERT INTO homes.home(id_home,created_by,name) VALUES
    ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Fixture');
    INSERT INTO devices.device(id_device,id_home,name,manufacturer_device_id,messaging_protocol)
    VALUES ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',
    'Existing','shelly-existing-before-upgrade','MQTT');`);
  phase = 'Liquibase existing revocation baseline';
  migrate('hu11_upgrade', 'tests/mqtt/hu11-revocation-baseline.yaml', 'update');
  const revocationBaseline = (
    await upgrade.query(
      'SELECT id, md5sum FROM databasechangelog ORDER BY orderexecuted',
    )
  ).rows;
  if (
    revocationBaseline.length !== before.length + 1 ||
    JSON.stringify(revocationBaseline.slice(0, -1)) !== JSON.stringify(before)
  )
    throw new Error('Baseline changesets changed or were reapplied');
  // Populate all pre-existing states before adding technical history. This is
  // disposable data only; production identities are never adopted by this test.
  phase = 'pre-existing identity fixture';
  for (const state of ['REGISTERED', 'REVOKE_PENDING', 'REVOKED']) {
    const deviceId = randomUUID();
    const identityId = randomUUID();
    const manufacturer = `shelly-baseline-${deviceId}`;
    await upgrade.query(
      `INSERT INTO devices.device(id_device,id_home,name,manufacturer_device_id,messaging_protocol)
      VALUES ($1,'22222222-2222-4222-8222-222222222222',$3,$2,'MQTT')`,
      [deviceId, manufacturer, `Baseline-${state}`],
    );
    await upgrade.query('SELECT devices.fn_register_mqtt_identity($1,$2,$3)', [
      deviceId,
      identityId,
      manufacturer,
    ]);
    if (state !== 'REGISTERED') {
      await upgrade.query(
        "UPDATE devices.device SET status='DEACTIVATED',deleted_at=clock_timestamp() WHERE id_device=$1",
        [deviceId],
      );
      const claim = (
        await upgrade.query('SELECT * FROM devices.fn_claim_mqtt_revocation()')
      ).rows[0];
      if (claim?.identity_id !== identityId)
        throw new Error('Unexpected baseline claim');
      await upgrade.query(
        'SELECT devices.fn_finish_mqtt_revocation($1,$2,$3)',
        [
          identityId,
          claim.claim_token,
          state === 'REVOKED' ? null : 'MQTT_ADMIN_UNAVAILABLE',
        ],
      );
      // Prevent the pending baseline job becoming due during image startup.
      if (state === 'REVOKE_PENDING')
        await upgrade.query(
          "UPDATE devices.mqtt_identity SET retry_at=clock_timestamp()+interval '1 hour' WHERE id_mqtt_identity=$1",
          [identityId],
        );
    }
  }
  const registrySql =
    'SELECT * FROM devices.mqtt_identity ORDER BY id_mqtt_identity';
  const registryBefore = JSON.stringify(
    (await upgrade.query(registrySql)).rows,
  );
  phase = 'Liquibase identity history incremental migration';
  migrate('hu11_upgrade', master, 'update');
  const after = (
    await upgrade.query(
      'SELECT id, md5sum FROM databasechangelog ORDER BY orderexecuted',
    )
  ).rows;
  if (
    after.length !== revocationBaseline.length + 1 ||
    JSON.stringify(after.slice(0, -1)) !== JSON.stringify(revocationBaseline) ||
    JSON.stringify((await upgrade.query(registrySql)).rows) !== registryBefore
  )
    throw new Error(
      'History migration changed existing checksums or identities',
    );
  const snapshots =
    await upgrade.query(`SELECT count(*)::int AS n FROM devices.mqtt_identity_event e
    JOIN devices.mqtt_identity i USING(id_mqtt_identity)
    WHERE e.event_type='BASELINE_SNAPSHOT' AND e.previous_state IS NULL
      AND e.state=i.state AND e.attempt_count=i.attempt_count
      AND e.error_code IS NOT DISTINCT FROM i.last_error_code`);
  if (snapshots.rows[0].n !== 3)
    throw new Error('Incorrect baseline observations');
  phase = 'Liquibase populated history rollback refusal';
  let refused = false;
  try {
    migrate('hu11_upgrade', master, 'rollback-count', ['--count=1']);
  } catch (error) {
    if (
      !String(error.stderr).includes(
        'MQTT_IDENTITY_HISTORY_ROLLBACK_REQUIRES_EMPTY_HISTORY',
      )
    )
      throw error;
    refused = true;
  }
  if (!refused)
    throw new Error('Populated history rollback unexpectedly succeeded');
  const retained = await upgrade.query(
    'SELECT count(*)::int AS n FROM devices.mqtt_identity_event',
  );
  const retainedChangesets = (
    await upgrade.query(
      'SELECT id, md5sum FROM databasechangelog ORDER BY orderexecuted',
    )
  ).rows;
  if (
    retained.rows[0].n !== 3 ||
    JSON.stringify(retainedChangesets) !== JSON.stringify(after)
  )
    throw new Error('Refused rollback changed history or changelog');
  migrate('hu11_upgrade', master, 'validate');
  console.log(
    'PASS: existing identities preserved, three baseline observations, populated history rollback refused.',
  );
  const existing =
    await upgrade.query(`SELECT count(*)::int AS n FROM devices.device
    WHERE manufacturer_device_id = 'shelly-existing-before-upgrade'`);
  if (existing.rows[0].n !== 1) throw new Error('Existing row changed');
  console.log(
    `PASS: incremental migration (${before.length} -> ${revocationBaseline.length} -> ${after.length} changesets), previous checksums and device preserved.`,
  );
  phase = 'PostgreSQL and real TLS broker integration tests';
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(__dirname, 'test-mqtt-identity.cjs'),
        database,
        '--with-revocation',
      ],
      {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
        env: {
          ...process.env,
          HU11_TEST_PG_PORT: String(settings.port),
          HU11_TEST_PG_PASSWORD: password,
          HU11_TEST_PG_CONTAINER: container,
          HU11_TEST_DATABASE_REPO: database,
        },
      },
    );
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (exitCode !== 0) throw new Error('Integration tests failed');
}
main()
  .catch(() => {
    console.error(
      `HU11 revocation tests failed during ${phase}; credential-bearing output suppressed.`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(pools.map((pool) => pool.end()));
    if (created) {
      try {
        command('docker', ['rm', '--force', container]);
        console.log('HU11 disposable PostgreSQL removed.');
      } catch {
        console.error('HU11 PostgreSQL cleanup failed.');
        process.exitCode = 1;
      }
    }
  });
