/**
 * BE-01 / EXCLUSIVE MQTT LAB 127.0.0.1:1885.
 * Verifies getClient.connections and the Mosquitto 2.1+ ACL deny defaults
 * using a synthetic
 * identity. Does not use a real Shelly, PostgreSQL or change AUTH_VERIFIED.
 */
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { randomBytes, randomUUID } from 'node:crypto';
import { connect, type MqttClient } from 'mqtt';
import { MosquittoDynamicSecurityProvider } from './mosquitto-dynamic-security.provider';
import { matchesBrokerIdentityConnection } from '../../application/services/shelly-mqtt-rpc-challenge.policy';

const BROKER = 'mqtt://127.0.0.1:1885';
const run = process.env.MQTT_DYNSEC_RUN_LAB_TEST === 'true' ? describe : describe.skip;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectSynthetic(username: string, password: string, clientId: string): Promise<MqttClient> {
  return new Promise<MqttClient>((resolve, reject) => {
    const client = connect(BROKER, {
      username,
      password,
      clientId,
      protocolVersion: 5,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: 4_000,
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.end(true);
      reject(new Error('MQTT_LAB_CONNECT_TIMEOUT'));
    }, 6_000);
    client.on('error', () => {
      if (settled) return; // Avoids an unhandled error after disableClient.
      settled = true;
      clearTimeout(timer);
      client.end(true);
      reject(new Error('MQTT_LAB_DEVICE_CONNECT_FAILED'));
    });
    client.once('connect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(client);
    });
  });
}

run('HU16 / conexion MQTT autenticada observada en Mosquitto (LAB REAL)', () => {
  it('only reports an active connection with an enabled account; revoking it kicks the client', async () => {
    // Strict guard: NEVER point these tests at a main/remote broker.
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.MQTT_DYNSEC_ADMIN_URL !== BROKER ||
      process.env.MQTT_DYNSEC_ADMIN_USERNAME !== 'admin' ||
      !process.env.MQTT_DYNSEC_ADMIN_PASSWORD?.startsWith('be01-lab-') ||
      process.env.MQTT_DYNSEC_ADMIN_PASSWORD.length < 32 ||
      process.env.MQTT_DYNSEC_RUN_LAB_TEST !== 'true'
    ) throw new Error('MQTT_LAB_SYNTHETIC_LOOPBACK_ADMIN_REQUIRED');

    const provider = new MosquittoDynamicSecurityProvider({
      get: (name: string) => process.env[name],
    } as never);

    const suffix = randomUUID().replace(/-/g, '').slice(0, 16);
    const username = `lab_observer_${suffix}`;
    const clientId = `lab-observer-${suffix}`;
    const roleName = `role_lab_observer_${suffix}`;
    const topicScope = `shelly1pmg4-${suffix}`;
    const password = randomBytes(40).toString('base64url');
    const binding = { username, clientId, roleName };
    let client: MqttClient | null = null;
    let prepared = false;

    try {
      await provider.prepareDisabled({
        operationId: `lab-observation-${suffix}`,
        username, clientId, roleName, password, topicScope,
        acls: [
          { type: 'publishClientSend', topic: `${topicScope}/status/switch:0`, priority: 10 },
          { type: 'publishClientSend', topic: `${topicScope}/events/rpc`, priority: 10 },
          { type: 'subscribeLiteral', topic: `${topicScope}/rpc`, priority: 10 },
          { type: 'publishClientReceive', topic: `${topicScope}/rpc`, priority: 10 },
          { type: 'unsubscribeLiteral', topic: `${topicScope}/rpc`, priority: 10 },
        ],
      });
      prepared = true;

      const disabled = await provider.inspectIdentity(username);
      expect(disabled).toMatchObject({ username, clientId, disabled: true, roleNames: [roleName] });
      expect(disabled?.authenticatedConnectionCount).toBe(0);
      expect(matchesBrokerIdentityConnection(disabled, binding)).toBe(false);

      await provider.enableIdentity(username);
      const enabledButOffline = await provider.inspectIdentity(username);
      expect(enabledButOffline?.disabled).toBe(false);
      expect(enabledButOffline?.authenticatedConnectionCount).toBe(0);
      expect(matchesBrokerIdentityConnection(enabledButOffline, binding)).toBe(false);

      client = await connectSynthetic(username, password, clientId);

      let active = await provider.inspectIdentity(username);
      for (let attempt = 0; attempt < 12 && !matchesBrokerIdentityConnection(active, binding); attempt++) {
        await sleep(150);
        active = await provider.inspectIdentity(username);
      }
      expect(active).not.toBeNull();
      expect(active?.authenticatedConnectionCount).toBe(1);
      expect(matchesBrokerIdentityConnection(active, binding)).toBe(true);

      // Dynamic Security must disconnect the active test client.
      await provider.disableIdentity(username);
      let revoked = await provider.inspectIdentity(username);
      for (let attempt = 0; attempt < 12 && revoked?.authenticatedConnectionCount !== 0; attempt++) {
        await sleep(150);
        revoked = await provider.inspectIdentity(username);
      }
      expect(revoked?.disabled).toBe(true);
      expect(revoked?.authenticatedConnectionCount).toBe(0);
      expect(matchesBrokerIdentityConnection(revoked, binding)).toBe(false);
    } finally {
      // Even if an assertion fails, never leave the synthetic identity enabled.
      client?.end(true);
      const snapshot = await provider.inspectIdentity(username);
      if (snapshot && !snapshot.disabled) await provider.disableIdentity(username);
      // By design, the LAB identity is kept disabled as evidence.
      if (prepared) console.info(`LAB_ONLY_DISABLED_IDENTITY=${username}`);
    }
  }, 90_000);
});
