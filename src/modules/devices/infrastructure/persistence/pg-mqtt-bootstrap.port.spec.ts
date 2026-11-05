import {
  MQTT_BOOTSTRAP_ENVELOPE_SQL,
  PgMqttBootstrapPort,
} from './pg-mqtt-bootstrap.port';

const OPERATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDENTITY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN_HASH = 'd'.repeat(64);

const envelope = () => ({
  operationId: OPERATION,
  identityId: IDENTITY,
  manufacturerDeviceId: 'shelly1pmg4-abcdef123456',
  username: `shd_${IDENTITY.replace(/-/g, '')}`,
  clientId: `shd-${IDENTITY.replace(/-/g, '')}`,
  topicScope: 'smarthome/dev/v1/devices/shelly1pmg4-abcdef123456',
  formatVersion: 1,
  keyId: 'dev-mqtt-aes-v1',
  nonce: Buffer.alloc(12).toString('base64url'),
  ciphertext: Buffer.alloc(43).toString('base64url'),
  authTag: Buffer.alloc(16).toString('base64url'),
  expiresAt: new Date(Date.now() + 60_000),
});

describe('PgMqttBootstrapPort (SQL031, sin secretos plaintext)', () => {
  it('pasa solo operacion, actor y hash del token a la funcion autorizada', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [envelope()] }) };
    const port = new PgMqttBootstrapPort(db);

    await expect(port.load(OPERATION, ACTOR, TOKEN_HASH)).resolves.toMatchObject({
      operationId: OPERATION,
      identityId: IDENTITY,
    });
    expect(db.query).toHaveBeenCalledWith(
      MQTT_BOOTSTRAP_ENVELOPE_SQL,
      [OPERATION, ACTOR, TOKEN_HASH],
    );
  });

  it('rechaza argumentos inválidos sin consultar SQL', async () => {
    const db = { query: jest.fn() };
    const port = new PgMqttBootstrapPort(db);
    await expect(port.load(OPERATION, ACTOR, 'raw-pairing-token'))
      .rejects.toThrow('MQTT_BOOTSTRAP_PORT_ARGUMENTS_INVALID');
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each([
    { identityId: 'not-a-uuid' },
    { operationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
    { formatVersion: 2 },
    { nonce: 'short' },
    { ciphertext: '' },
    { expiresAt: 'invalid-date' },
  ])('rechaza una respuesta SQL incompleta o mal formada: %j', async (override) => {
    const db = {
      query: jest.fn().mockResolvedValue({ rows: [{ ...envelope(), ...override }] }),
    };
    const port = new PgMqttBootstrapPort(db);
    await expect(port.load(OPERATION, ACTOR, TOKEN_HASH))
      .rejects.toThrow('MQTT_BOOTSTRAP_PORT_RESULT_INVALID');
  });

  it('falla cerrado ante respuesta ausente o ambigua', async () => {
    for (const rows of [[], [envelope(), envelope()]]) {
      const port = new PgMqttBootstrapPort({
        query: jest.fn().mockResolvedValue({ rows }),
      });
      await expect(port.load(OPERATION, ACTOR, TOKEN_HASH))
        .rejects.toThrow('MQTT_BOOTSTRAP_PORT_RESULT_INVALID');
    }
  });
});
