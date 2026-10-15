// Creates and removes ONLY its own disposable broker. Never reads .env.
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes, randomUUID, pbkdf2Sync } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const tls = require('node:tls');

const root = path.resolve(__dirname, '..');
const database = path.resolve(
  process.argv[2] || path.join(root, 'smarthome-database'),
);
const fixture = path.join(database, 'tests', 'mqtt', 'mosquitto.conf');
const image = 'eclipse-mosquitto:2.0.22';
const container = `smarthome-hu11-test-${randomUUID()}`;
const temporaryRoot = path.join(root, '.tmp');
let temporary;
let created = false;
let phase = 'preflight';
function command(program, args) {
  return execFileSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    windowsHide: true,
  });
}
async function main() {
  if (!fs.existsSync(fixture)) throw new Error('Missing database test fixture');
  command('docker', ['image', 'inspect', image]);
  const openssl =
    process.env.OPENSSL_EXECUTABLE ||
    (process.platform === 'win32'
      ? 'C:/Program Files/Git/usr/bin/openssl.exe'
      : 'openssl');
  command(openssl, ['version']);
  fs.mkdirSync(temporaryRoot, { recursive: true });
  temporary = fs.mkdtempSync(path.join(temporaryRoot, 'mqtt-identity-'));
  const file = (name) => path.join(temporary, name);
  phase = 'temporary certificates';
  command(openssl, [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=HU11-Disposable-CA',
    '-keyout',
    file('ca.key'),
    '-out',
    file('ca.crt'),
  ]);
  command(openssl, [
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=localhost',
    '-keyout',
    file('server.key'),
    '-out',
    file('server.csr'),
  ]);
  fs.writeFileSync(
    file('extensions.cnf'),
    'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',
  );
  command(openssl, [
    'x509',
    '-req',
    '-days',
    '1',
    '-in',
    file('server.csr'),
    '-CA',
    file('ca.crt'),
    '-CAkey',
    file('ca.key'),
    '-CAcreateserial',
    '-out',
    file('server.crt'),
    '-extfile',
    file('extensions.cnf'),
  ]);
  const adminPassword = randomBytes(32).toString('base64url');
  const salt = randomBytes(12);
  // Mosquitto 2.0.x dynsec verifier format; fixture administrator only.
  const iterations = 100000;
  const initial = {
    defaultACLAccess: {
      publishClientSend: false,
      publishClientReceive: false,
      subscribe: false,
      unsubscribe: true,
    },
    clients: [
      {
        username: 'hu11-fixture-admin',
        clientid: 'hu11-fixture-admin',
        salt: salt.toString('base64'),
        password: pbkdf2Sync(
          adminPassword,
          salt,
          iterations,
          64,
          'sha512',
        ).toString('base64'),
        iterations,
        roles: [{ rolename: 'hu11-admin', priority: 0 }],
      },
    ],
    groups: [],
    roles: [
      {
        rolename: 'hu11-admin',
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
      },
    ],
  };
  fs.writeFileSync(file('initial.json'), JSON.stringify(initial), {
    mode: 0o600,
  });
  phase = 'disposable broker';
  // Every mount is read-only; broker state lives only in tmpfs. No named volumes.
  command('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    container,
    '--label',
    'smarthome.test=hu11',
    '--publish',
    '127.0.0.1::8883',
    '--tmpfs',
    '/run/hu11:rw,noexec,nosuid,size=16777216,mode=0700',
    '--mount',
    `type=bind,source=${temporary},target=/fixture,readonly`,
    '--mount',
    `type=bind,source=${fixture},target=/mosquitto/config/mosquitto.conf,readonly`,
    '--entrypoint',
    'sh',
    image,
    '-c',
    'cp /fixture/server.crt /fixture/server.key /run/hu11/ && cp /fixture/initial.json /run/hu11/dynamic-security.json && chown -R mosquitto:mosquitto /run/hu11 && chmod 600 /run/hu11/* && exec mosquitto -c /mosquitto/config/mosquitto.conf',
  ]);
  created = true;
  const published = command('docker', ['port', container, '8883/tcp']).trim();
  const match = /^127\.0\.0\.1:(\d+)$/.exec(published);
  if (!match) throw new Error('Expected loopback-only port');
  const port = Number(match[1]);
  const ca = fs.readFileSync(file('ca.crt'));
  let ready = false;
  for (let attempt = 0; attempt < 30 && !ready; attempt++) {
    ready = await new Promise((resolve) => {
      const socket = tls.connect({
        host: '127.0.0.1',
        port,
        ca,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      });
      socket.setTimeout(1000);
      socket.once('secureConnect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Disposable TLS listener not ready');
  console.log(
    'HU11 disposable Mosquitto 2.0.22: TLS ready on loopback; no existing services used.',
  );
  phase = 'broker integration tests';
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        require.resolve('jest/bin/jest'),
        '--config',
        './test/jest-e2e.json',
        '--runInBand',
        '--runTestsByPath',
        'test/mqtt-identity-broker.e2e-spec.ts',
      ],
      {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
        env: {
          ...process.env,
          HU11_TEST_BROKER: `mqtts://127.0.0.1:${port}`,
          HU11_TEST_CA: file('ca.crt'),
          HU11_TEST_ADMIN_PASSWORD: adminPassword,
          HU11_TEST_CONTAINER: container,
        },
      },
    );
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (exitCode !== 0) throw new Error('Broker integration tests failed');
  console.log('HU11 broker suite passed.');
}
main()
  .catch(() => {
    console.error(
      `HU11 test failed during ${phase}; secret-bearing command output suppressed.`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    if (created) {
      try {
        command('docker', ['rm', '--force', container]);
        console.log('HU11 disposable container removed.');
      } catch {
        console.error('HU11 disposable container cleanup failed.');
        process.exitCode = 1;
      }
    }
    if (temporary) {
      const target = path.resolve(temporary);
      if (
        path.dirname(target) !== temporaryRoot ||
        !path.basename(target).startsWith('mqtt-identity-')
      )
        throw new Error('Unsafe cleanup target');
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
