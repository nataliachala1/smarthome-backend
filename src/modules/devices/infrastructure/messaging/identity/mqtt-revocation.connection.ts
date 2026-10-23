import { connect, IClientOptions, MqttClient } from 'mqtt';
import { deviceMqttUsername } from './device-mqtt-policy';
import {
  BrokerAdminError,
  MosquittoAdminTransport,
} from './mosquitto-admin.transport';

/** One clean connection per disable operation. No persistent outgoing queue,
 * reconnect or enable/rotate API. The supervisor serializes invocations.
 */
export class MqttRevocationConnection {
  constructor(
    private readonly url: string,
    private readonly options: IClientOptions,
  ) {
    if (!url.startsWith('mqtts://') || options.rejectUnauthorized !== true)
      throw new Error('MQTT_ADMIN_TLS_REQUIRED');
  }

  async revoke(identityId: string): Promise<void> {
    const username = deviceMqttUsername(identityId);
    let client: MqttClient | undefined;
    let transport: MosquittoAdminTransport | undefined;
    try {
      client = connect(this.url, {
        ...this.options,
        clean: true,
        reconnectPeriod: 0,
        connectTimeout: 5000,
        queueQoSZero: false,
        protocolVersion: 5,
        protocol: 'mqtts',
      });
      // Absorb socket errors after connect and during close; never log payloads.
      client.on('error', () => {});
      await this.waitForConnection(client);
      transport = new MosquittoAdminTransport(client, 5000);
      await transport.execute({ command: 'disableClient', username });
    } catch (error) {
      if (error instanceof BrokerAdminError) throw error;
      throw new BrokerAdminError('MQTT_ADMIN_UNAVAILABLE');
    } finally {
      transport?.close();
      if (client) await this.disconnect(client);
    }
  }

  private waitForConnection(client: MqttClient): Promise<void> {
    return new Promise((resolve, reject) => {
      const complete = (connected: boolean) => {
        clearTimeout(timeout);
        client.off('connect', success);
        client.off('error', failure);
        client.off('close', failure);
        if (connected) resolve();
        else reject(new BrokerAdminError('MQTT_ADMIN_UNAVAILABLE'));
      };
      const success = () => complete(true);
      const failure = () => complete(false);
      const timeout = setTimeout(failure, 5000);
      client.once('connect', success);
      client.once('error', failure);
      client.once('close', failure);
      if (client.connected) success();
    });
  }

  private disconnect(client: MqttClient): Promise<void> {
    return new Promise((resolve) => {
      // force=true discards QoS packets; only the durable DB job may retry.
      const timeout = setTimeout(() => {
        client.stream?.destroy();
        resolve();
      }, 1000);
      try {
        client.end(true, {}, () => {
          clearTimeout(timeout);
          resolve();
        });
      } catch {
        clearTimeout(timeout);
        client.stream?.destroy();
        resolve();
      }
    });
  }
}
