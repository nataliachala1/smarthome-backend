// Jest ejecuta esta suite como CommonJS; no debe cargar @nestjs/config (ESM) en runtime.
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { randomBytes, randomUUID } from 'node:crypto';
import { connect } from 'mqtt';
import { MosquittoDynamicSecurityProvider } from './mosquitto-dynamic-security.provider';

describe('MosquittoDynamicSecurityProvider safety', () => {
  const make = (values: Record<string, string | undefined>) =>
    new MosquittoDynamicSecurityProvider({
      get: (name: string) => values[name],
    } as never);

  it('fails closed without independent admin credentials', async () => {
    const provider = make({});
    await expect(provider.inspectIdentity('lab_shelly_001')).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_ADMIN_NOT_CONFIGURED' },
    });
  });

  it('rejects plaintext administrative connections outside loopback', async () => {
    const provider = make({
      NODE_ENV: 'development',
      MQTT_DYNSEC_ADMIN_URL: 'mqtt://broker.example.com:1883',
      MQTT_DYNSEC_ADMIN_USERNAME: 'admin',
      MQTT_DYNSEC_ADMIN_PASSWORD: 'secret-for-tests-only',
    });
    await expect(provider.inspectIdentity('lab_shelly_001')).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_ADMIN_TRANSPORT_UNSAFE' },
    });
  });

  it('rejects unencrypted administrative connections in production', async () => {
    const provider = make({
      NODE_ENV: 'production',
      MQTT_DYNSEC_ADMIN_URL: 'mqtt://127.0.0.1:1885',
      MQTT_DYNSEC_ADMIN_USERNAME: 'admin',
      MQTT_DYNSEC_ADMIN_PASSWORD: 'secret-for-tests-only',
    });
    await expect(provider.inspectIdentity('lab_shelly_001')).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_ADMIN_TRANSPORT_UNSAFE' },
    });
  });

  it('rejects a wildcard that grants access to every device', async () => {
    const provider = make({});
    await expect(provider.prepareDisabled({
      operationId: 'lab-operation-001',
      username: 'lab_shelly_001',
      clientId: 'lab-shelly-001',
      roleName: 'role_lab_shelly_001',
      password: 'correct-test-password-at-least-32-characters',
      topicScope: 'shelly1pmg4-testdevice001',
      acls: [{ type: 'publishClientSend', topic: '#', priority: 10 }],
    })).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_UNSAFE_ACL' },
    });
  });

  const pairRequest = () => ({
    operationId: 'pairing-test-001',
    username: 'device_user_001',
    clientId: 'client-shelly-001',
    roleName: 'role_device_001',
    password: 'test-password-with-at-least-32-characters',
    topicScope: 'smarthome/test/devices/shelly1pmg4-device001',
    acls: [
      {
        type: 'publishClientSend' as const,
        topic: 'smarthome/test/devices/shelly1pmg4-device001/status/switch:0',
        priority: 10,
      },
      {
        type: 'publishClientSend' as const,
        topic: 'smarthome/test/devices/shelly1pmg4-device001/events/rpc',
        priority: 10,
      },
      {
        type: 'publishClientReceive' as const,
        topic: 'smarthome/test/devices/shelly1pmg4-device001/rpc',
        priority: 10,
      },
      {
        type: 'subscribeLiteral' as const,
        topic: 'smarthome/test/devices/shelly1pmg4-device001/rpc',
        priority: 10,
      },
      {
        type: 'unsubscribeLiteral' as const,
        topic: 'smarthome/test/devices/shelly1pmg4-device001/rpc',
        priority: 10,
      },
    ],
  });

  it('rejects an ACL for a different physical device', async () => {
    const provider = make({});
    const input = pairRequest();
    input.acls[0].topic = 'smarthome/test/devices/shelly1pmg4-other/status/switch:0';
    await expect(provider.prepareDisabled(input)).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_UNSAFE_ACL' },
    });
  });

  it('rejects a wildcard inside the device namespace', async () => {
    const provider = make({});
    const input = pairRequest();
    input.acls[0].topic = `${input.topicScope}/status/#`;
    await expect(provider.prepareDisabled(input)).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_UNSAFE_ACL' },
    });
  });

  it('rejects an administrative ACL', async () => {
    const provider = make({});
    const input = pairRequest();
    input.acls[0].topic = '$CONTROL/dynamic-security/v1';
    await expect(provider.prepareDisabled(input)).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_UNSAFE_ACL' },
    });
  });

  it('accepts the exact Shelly ACL shape before contacting the broker', async () => {
    const provider = make({});
    await expect(provider.prepareDisabled(pairRequest())).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_ADMIN_NOT_CONFIGURED' },
    });
  });

  it('revokes idempotently and skips disableClient when the identity is already disabled', async () => {
    const provider = make({});
    const command = jest.spyOn(provider as never, 'command')
      .mockResolvedValue({ client: {
        username: 'device_user_001', clientid: 'client-shelly-001',
        disabled: true, roles: [], connections: [],
      } });
    await expect(provider.disableIdentity('device_user_001')).resolves.toBeUndefined();
    expect(command).toHaveBeenCalledTimes(2);
    expect(command).toHaveBeenCalledWith('getClient', { username: 'device_user_001' });
    expect(command).not.toHaveBeenCalledWith('disableClient', expect.anything());
  });

  it('confirma el estado posterior antes de aceptar disableClient', async () => {
    const provider = make({});
    const command = jest.spyOn(provider as never, 'command')
      .mockResolvedValueOnce({ client: {
        username: 'device_user_001', clientid: 'client-shelly-001',
        disabled: false, roles: [], connections: [],
      } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ client: {
        username: 'device_user_001', clientid: 'client-shelly-001',
        disabled: true, roles: [], connections: [],
      } });
    await expect(provider.disableIdentity('device_user_001')).resolves.toBeUndefined();
    expect(command).toHaveBeenNthCalledWith(2, 'disableClient', {
      username: 'device_user_001',
    });
  });

  it('rejects an invalid topic scope', async () => {
    const provider = make({});
    const input = pairRequest();
    input.topicScope = 'smarthome/test/devices/+/status';
    await expect(provider.prepareDisabled(input)).rejects.toMatchObject({
      response: { code: 'MQTT_DYNSEC_INVALID_TOPIC_SCOPE' },
    });
  });
});

/**
 * Verifica el CONNACK, no solo el resultado de mosquitto_pub.
 * El password aleatorio no se imprime ni se guarda en disco.
 */
async function canAuthenticateInLab(
  username: string,
  clientId: string,
  password: string,
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const client = connect('mqtt://127.0.0.1:1885', {
      username,
      password,
      clientId,
      protocolVersion: 5,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: 4000,
    });
    let finished = false;
    const finish = (allowed?: boolean, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      client.end(true);
      if (error) reject(error);
      else resolve(allowed === true);
    };
    const timer = setTimeout(
      () => finish(undefined, new Error('MQTT_LAB_CONNECTION_TIMEOUT')),
      6000,
    );
    client.once('connect', () => finish(true));
    client.once('error', (error: Error & { reasonCode?: number }) => {
      if (error.reasonCode === 135 || /not authorized/i.test(error.message)) {
        finish(false);
      } else {
        finish(undefined, error);
      }
    });
  });
}

// Prueba con broker real opcional: correr UNICAMENTE con el laboratorio aislado.
const live = process.env.MQTT_DYNSEC_RUN_LAB_TEST === 'true' ? describe : describe.skip;
live('MosquittoDynamicSecurityProvider lab integration', () => {
  it('reads the disabled lab identity through the broker control API', async () => {
    const provider = new MosquittoDynamicSecurityProvider({
      get: (name: string) => process.env[name],
    } as never);
    await expect(provider.inspectIdentity('lab_shelly_001')).resolves.toMatchObject({
      username: 'lab_shelly_001',
      clientId: 'lab-shelly-001',
      disabled: true,
      roleNames: ['role_lab_shelly_001'],
    });
  });

  it('prepares, activates and revokes a unique lab identity', async () => {
    // Este test ESCRIBE en el broker; bloquear cualquier destino diferente
    // del laboratorio local, incluso si alguien lo ejecuta por accidente.
    if (
      process.env.MQTT_DYNSEC_ADMIN_URL !== 'mqtt://127.0.0.1:1885' ||
      process.env.NODE_ENV === 'production'
    ) {
      throw new Error('MQTT_DYNSEC_WRITE_TEST_REQUIRES_LOCAL_LAB_1885');
    }

    const provider = new MosquittoDynamicSecurityProvider({
      get: (name: string) => process.env[name],
    } as never);
    const suffix = randomUUID().replace(/-/g, '').slice(0, 16);
    const username = `lab_shelly_${suffix}`;
    const clientId = `lab-shelly-${suffix}`;
    const roleName = `role_lab_shelly_${suffix}`;
    const topicScope = `smarthome/test/devices/shelly1pmg4-${suffix}`;
    const password = randomBytes(32).toString('base64url');

    const request = {
      operationId: `lab-operation-${suffix}`,
      username,
      clientId,
      roleName,
      password,
      topicScope,
      acls: [
        { type: 'publishClientSend' as const, topic: `${topicScope}/status/switch:0`, priority: 10 },
        { type: 'publishClientSend' as const, topic: `${topicScope}/events/rpc`, priority: 10 },
        { type: 'publishClientReceive' as const, topic: `${topicScope}/rpc`, priority: 10 },
        { type: 'subscribeLiteral' as const, topic: `${topicScope}/rpc`, priority: 10 },
        { type: 'unsubscribeLiteral' as const, topic: `${topicScope}/rpc`, priority: 10 },
      ],
    };

    // Después de la creación, la identidad debe permanecer bloqueada.
    // En caso de fallo, la limpieza vuelve a deshabilitarla.
    try {
      await provider.prepareDisabled(request);
      await expect(provider.inspectIdentity(username)).resolves.toMatchObject({
        username,
        clientId,
        disabled: true,
        roleNames: [roleName],
      });
      expect(await canAuthenticateInLab(username, clientId, password)).toBe(false);

      await provider.enableIdentity(username);
      await expect(provider.inspectIdentity(username)).resolves.toMatchObject({
        username,
        clientId,
        disabled: false,
      });
      expect(await canAuthenticateInLab(username, clientId, password)).toBe(true);

      await provider.disableIdentity(username);
      await expect(provider.inspectIdentity(username)).resolves.toMatchObject({
        username,
        clientId,
        disabled: true,
      });
      expect(await canAuthenticateInLab(username, clientId, password)).toBe(false);
    } finally {
      // Se conserva la identidad deshabilitada como evidencia en laboratorio.
      // Si no existe, no hay nada que revocar. Un fallo de broker NO equivale
      // a ausencia confirmada y no debe ocultarse.
      const snapshot = await provider.inspectIdentity(username);
      if (snapshot && !snapshot.disabled) {
        await provider.disableIdentity(username);
      }
    }
  }, 60000);
});
