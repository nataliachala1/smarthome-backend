import { randomUUID } from 'node:crypto';
import { connect, type MqttClient } from 'mqtt';
import type { MqttRuntimeService } from './mqtt-runtime.service';
import type {
  MqttRpcChallengeTransport,
} from '../../application/services/shelly-mqtt-broker-proof.coordinator';
import type {
  ShellyRpcChallenge,
  ShellyRpcMessage,
} from '../../application/services/shelly-mqtt-rpc-challenge.policy';

/**
 * Adaptador MQTT de una sola llamada, sin credenciales DynSec admin.
 * Se suscribe ANTES de publicar el desafio; fail-closed sin reconexiones.
 * No registrar automaticamente: primero exige worker/lease/ACL exactos.
 */
export class ShellyMqttRpcChallengeTransport implements MqttRpcChallengeTransport {
  constructor(private readonly mqtt: Pick<MqttRuntimeService, 'config' | 'clientOptions'>) {}

  exchange(challenge: ShellyRpcChallenge): Promise<ShellyRpcMessage> {
    const url = this.mqtt.config.brokerUrl;
    const left = challenge.expiresAtMs - Date.now();
    if (!url || !this.mqtt.config.tls || !url.startsWith('mqtts://') ||
        left <= 0 || left > 15_000 ||
        !challenge.requestTopic.endsWith('/rpc') ||
        !challenge.responseTopic.endsWith('/events/rpc')) {
      return Promise.reject(new Error('MQTT_RPC_PROOF_UNAVAILABLE'));
    }
    return new Promise<ShellyRpcMessage>((resolve, reject) => {
      let client: MqttClient | undefined;
      let settled = false;
      const finish = (message?: ShellyRpcMessage): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (client) client.end(true);
        if (message) resolve(message);
        else reject(new Error('MQTT_RPC_PROOF_UNCERTAIN'));
      };
      const timer = setTimeout(() => finish(), left);
      try {
        const options = this.mqtt.clientOptions('control');
        client = connect(url, {
          ...options,
          clientId: `sh-proof-${randomUUID()}`,
          reconnectPeriod: 0,
          connectTimeout: Math.min(5000, left),
          clean: true,
        });
        client.on('error', () => finish());
        client.on('close', () => finish());
        client.on('message', (topic, payload, packet) => {
          if (topic !== challenge.responseTopic || settled) return;
          finish({
            topic,
            payload: Buffer.from(payload),
            retain: packet.retain === true,
            receivedAtMs: Date.now(),
          });
        });
        client.on('connect', () => {
          if (settled) return;
          client?.subscribe(challenge.responseTopic, { qos: 1 }, (err, grants) => {
            if (settled) return;
            if (err || !grants?.some((g) => g.topic === challenge.responseTopic && g.qos !== 128)) {
              finish();
              return;
            }
            client?.publish(challenge.requestTopic, challenge.payload, {
              qos: 1, retain: false,
            }, (publishError) => { if (publishError) finish(); });
          });
        });
      } catch {
        finish();
      }
    });
  }
}
