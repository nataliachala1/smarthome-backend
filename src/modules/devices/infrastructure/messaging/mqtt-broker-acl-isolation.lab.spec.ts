/**
 * Isolated Mosquitto 2.1+ lab only. Requires a loopback-only broker at
 * 127.0.0.1:1885 and synthetic credentials with the be01-lab- prefix.
 */
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { createHmac } from 'node:crypto';
import { connect, type MqttClient, type Packet } from 'mqtt';
import { MosquittoDynamicSecurityProvider } from './mosquitto-dynamic-security.provider';
import type {
  PrepareMqttIdentityInput,
  VerifyPreparedMqttIdentityInput,
} from '../../domain/services/mqtt-device-identity-provider';

const BROKER = 'mqtt://127.0.0.1:1885';
const runIsolation = process.env.MQTT_DYNSEC_RUN_LAB_TEST === 'true' ? describe : describe.skip;
const runRecovery = process.env.MQTT_DYNSEC_RUN_PERSISTENCE_LAB_TEST === 'true'
  ? describe
  : describe.skip;

type LabDevice = {
  readonly username: string;
  readonly clientId: string;
  readonly roleName: string;
  readonly topicScope: string;
  readonly password: string;
  readonly prepare: PrepareMqttIdentityInput;
  readonly verify: VerifyPreparedMqttIdentityInput;
};

function requireIsolatedLab(): string {
  const runId = process.env.BE01_LAB_RUN_ID;
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.MQTT_DYNSEC_ADMIN_URL !== BROKER ||
    process.env.MQTT_DYNSEC_ADMIN_USERNAME !== 'admin' ||
    !process.env.MQTT_DYNSEC_ADMIN_PASSWORD?.startsWith('be01-lab-') ||
    process.env.MQTT_DYNSEC_ADMIN_PASSWORD.length < 32 ||
    !runId || !/^[a-f0-9]{12}$/.test(runId)
  ) throw new Error('MQTT_LAB_SYNTHETIC_LOOPBACK_ADMIN_REQUIRED');
  return runId;
}

function makeDevice(runId: string, suffix: 'a' | 'b'): LabDevice {
  const username = `be01_lab_${suffix}_${runId}`;
  const clientId = `be01-lab-${suffix}-${runId}`;
  const roleName = `role_be01_lab_${suffix}_${runId}`;
  const topicScope = `shelly1pmg4-${suffix}-${runId}`;
  // Stable only within this isolated run so the persistence test can retry
  // the same synthetic credentials after the broker container restarts.
  const password = createHmac('sha256', process.env.MQTT_DYNSEC_ADMIN_PASSWORD!)
    .update(`be01-lab-device:${runId}:${suffix}`)
    .digest('base64url');
  const acls = [
    { type: 'publishClientSend', topic: `${topicScope}/status/switch:0`, priority: 10 },
    { type: 'publishClientSend', topic: `${topicScope}/events/rpc`, priority: 10 },
    { type: 'subscribeLiteral', topic: `${topicScope}/rpc`, priority: 10 },
    { type: 'publishClientReceive', topic: `${topicScope}/rpc`, priority: 10 },
    { type: 'unsubscribeLiteral', topic: `${topicScope}/rpc`, priority: 10 },
  ] as const;
  const prepare = {
    operationId: `lab-${suffix}-${runId}`,
    username,
    clientId,
    roleName,
    password,
    topicScope,
    acls,
  } satisfies PrepareMqttIdentityInput;
  const verify: VerifyPreparedMqttIdentityInput = {
    username: prepare.username,
    clientId: prepare.clientId,
    roleName: prepare.roleName,
    topicScope: prepare.topicScope,
    acls: prepare.acls,
  };
  return { ...prepare, prepare, verify };
}

function createProvider(): MosquittoDynamicSecurityProvider {
  return new MosquittoDynamicSecurityProvider({
    get: (name: string) => process.env[name],
  } as never);
}

async function connectSynthetic(device: LabDevice): Promise<MqttClient> {
  return new Promise<MqttClient>((resolve, reject) => {
    const client = connect(BROKER, {
      username: device.username,
      password: device.password,
      clientId: device.clientId,
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
    client.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end(true);
      reject(error);
    });
    client.once('connect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(client);
    });
  });
}

function subscribe(client: MqttClient, topic: string): Promise<{
  error: Error | null;
  granted?: Array<{ qos: number }>;
}> {
  return new Promise((resolve) => {
    client.subscribe(topic, { qos: 1 }, (error, granted) => {
      resolve({ error: error ?? null, granted });
    });
  });
}

function publish(client: MqttClient, topic: string): Promise<{
  error?: Error;
  packet?: Packet;
}> {
  return new Promise((resolve) => {
    client.publish(topic, 'be01-lab-probe', { qos: 1, retain: false }, (error, packet) => {
      resolve({ error: error ?? undefined, packet });
    });
  });
}

function reasonCode(value: Error | Packet | undefined): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { code?: unknown; reasonCode?: unknown };
  if (typeof candidate.reasonCode === 'number') return candidate.reasonCode;
  if (typeof candidate.code === 'number') return candidate.code;

  // mqtt.js wraps a rejected MQTT 5 SUBACK in ErrorWithSubackPacket;
  // its protocol reason code is preserved in packet.granted.
  const suback = (value as Error & { packet?: { granted?: unknown } }).packet;
  if (Array.isArray(suback?.granted)) {
    const denied = suback.granted.find(
      (code): code is number => typeof code === 'number' && code >= 128,
    );
    if (denied !== undefined) return denied;
  }
  return undefined;
}

runIsolation('Mosquitto lab / ACLs aisladas por identidad', () => {
  it('rejects a disabled identity, separates two devices and revokes without connections', async () => {
    const runId = requireIsolatedLab();
    const provider = createProvider();
    const devices = [makeDevice(runId, 'a'), makeDevice(runId, 'b')] as const;
    const clients: MqttClient[] = [];
    let preserveBForRecovery = false;

    try {
      await provider.verifyBrokerPrerequisites();
      for (const device of devices) {
        await provider.prepareDisabled(device.prepare);
        const disabled = await provider.inspectIdentity(device.username);
        expect(disabled).toMatchObject({
          username: device.username,
          clientId: device.clientId,
          disabled: true,
          roleNames: [device.roleName],
          authenticatedConnectionCount: 0,
        });
        await expect(connectSynthetic(device)).rejects.toBeTruthy();
        await provider.verifyPreparedDisabled(device.verify);
      }

      for (const device of devices) await provider.enableIdentity(device.username);
      for (const device of devices) clients.push(await connectSynthetic(device));

      for (let index = 0; index < devices.length; index++) {
        const device = devices[index];
        const other = devices[1 - index];
        const ownSnapshot = await provider.inspectIdentity(device.username);
        expect(ownSnapshot?.authenticatedConnectionCount).toBe(1);
        expect(ownSnapshot?.clientId).toBe(device.clientId);
        expect(ownSnapshot?.disabled).toBe(false);

        const ownSubscription = await subscribe(clients[index], `${device.topicScope}/rpc`);
        expect(ownSubscription.error).toBeNull();
        expect(ownSubscription.granted?.[0]?.qos).toBe(1);

        const crossSubscription = await subscribe(clients[index], `${other.topicScope}/rpc`);
        expect(crossSubscription.error).toBeTruthy();
        expect(reasonCode(crossSubscription.error)).toBeGreaterThanOrEqual(128);

        const ownPublish = await publish(clients[index], `${device.topicScope}/events/rpc`);
        expect(ownPublish.error).toBeUndefined();
        const ownStatusPublish = await publish(clients[index], `${device.topicScope}/status/switch:0`);
        expect(ownStatusPublish.error).toBeUndefined();

        const crossPublish = await publish(clients[index], `${other.topicScope}/events/rpc`);
        expect(reasonCode(crossPublish.error ?? crossPublish.packet)).toBe(135);
        const crossStatusPublish = await publish(clients[index], `${other.topicScope}/status/switch:0`);
        expect(reasonCode(crossStatusPublish.error ?? crossStatusPublish.packet)).toBe(135);
      }

      for (const device of devices) await provider.disableIdentity(device.username);
      for (const device of devices) {
        const revoked = await provider.inspectIdentity(device.username);
        expect(revoked?.disabled).toBe(true);
        expect(revoked?.authenticatedConnectionCount).toBe(0);
        await expect(connectSynthetic(device)).rejects.toBeTruthy();
        await provider.verifyPreparedDisabled(device.verify);
      }

      console.info(`BE01_LAB_RUN_ID=${runId}`);
      console.info(`BE01_LAB_REVOKED_IDENTITY=${devices[0].username}`);
      await provider.enableIdentity(devices[1].username);
      const recoveryIdentity = await provider.inspectIdentity(devices[1].username);
      expect(recoveryIdentity).toMatchObject({
        username: devices[1].username,
        clientId: devices[1].clientId,
        disabled: false,
        roleNames: [devices[1].roleName],
        authenticatedConnectionCount: 0,
      });
      console.info(`BE01_LAB_RECOVERY_IDENTITY=${devices[1].username}`);
      preserveBForRecovery = true;
    } finally {
      for (const client of clients) client.end(true);
      for (const device of devices) {
        if (preserveBForRecovery && device.username === devices[1].username) continue;
        try {
          const snapshot = await provider.inspectIdentity(device.username);
          if (snapshot && !snapshot.disabled) await provider.disableIdentity(device.username);
        } catch {
          // Keep the original failure visible; this lab never points outside loopback.
        }
      }
    }
  }, 120_000);
});

runRecovery('Mosquitto lab / persistencia DynSec tras reinicio', () => {
  it('rejects the revoked identity and recovers the authorized connection after a restart', async () => {
    const runId = requireIsolatedLab();
    const provider = createProvider();
    const revokedDevice = makeDevice(runId, 'a');
    const recoveryDevice = makeDevice(runId, 'b');
    let recoveredClient: MqttClient | null = null;

    try {
      await provider.verifyBrokerPrerequisites();
      await provider.verifyPreparedDisabled(revokedDevice.verify);
      const revoked = await provider.inspectIdentity(revokedDevice.username);
      expect(revoked).toMatchObject({
        username: revokedDevice.username,
        clientId: revokedDevice.clientId,
        disabled: true,
        roleNames: [revokedDevice.roleName],
        authenticatedConnectionCount: 0,
      });
      await expect(connectSynthetic(revokedDevice)).rejects.toBeTruthy();

      const recovered = await provider.inspectIdentity(recoveryDevice.username);
      expect(recovered).toMatchObject({
        username: recoveryDevice.username,
        clientId: recoveryDevice.clientId,
        disabled: false,
        roleNames: [recoveryDevice.roleName],
        authenticatedConnectionCount: 0,
      });
      recoveredClient = await connectSynthetic(recoveryDevice);
      const active = await provider.inspectIdentity(recoveryDevice.username);
      expect(active).toMatchObject({
        username: recoveryDevice.username,
        clientId: recoveryDevice.clientId,
        disabled: false,
        roleNames: [recoveryDevice.roleName],
        authenticatedConnectionCount: 1,
      });

      await provider.disableIdentity(recoveryDevice.username);
      const revokedAfterRecovery = await provider.inspectIdentity(recoveryDevice.username);
      expect(revokedAfterRecovery?.disabled).toBe(true);
      expect(revokedAfterRecovery?.authenticatedConnectionCount).toBe(0);
      await provider.verifyPreparedDisabled(recoveryDevice.verify);
      await expect(connectSynthetic(recoveryDevice)).rejects.toBeTruthy();
    } finally {
      recoveredClient?.end(true);
      try {
        const snapshot = await provider.inspectIdentity(recoveryDevice.username);
        if (snapshot && !snapshot.disabled) await provider.disableIdentity(recoveryDevice.username);
      } catch {
        // Keep the original failure visible; the project and volume are isolated.
      }
    }
  }, 60_000);
});
