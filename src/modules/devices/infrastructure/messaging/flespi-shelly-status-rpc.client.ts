import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { connect } from 'mqtt';
import { MqttRuntimeService } from './mqtt-runtime.service';

/** A single verified Switch.GetStatus result. This adapter never writes to DB. */
export interface FlespiShellySwitchStatus {
  output: boolean;
  powerW?: number;
  voltageV?: number;
  currentA?: number;
  energyTotalWh?: number;
  receivedAt: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNonnegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value : undefined;
}

/**
 * DEV/flespi only: sends exactly Switch.GetStatus over TLS MQTT.
 * Each call uses an independent, random MQTT clientId so it cannot evict the
 * long-lived status/control clients. No relay writes, no persistent connection.
 * A later stage may reconcile this response transactionally with SQL036.
 */
@Injectable()
export class FlespiShellyStatusRpcClient {
  constructor(private readonly mqtt: MqttRuntimeService) {}

  async getSwitchStatus(): Promise<FlespiShellySwitchStatus> {
    const config = this.mqtt.config;
    const id = config.flespiDeviceId;
    const broker = config.brokerUrl;
    const source = config.rpcSource;
    if (!id || !config.namespace || !config.tls ||
        broker !== 'mqtts://mqtt.flespi.io:8883' ||
        source !== `${config.namespace}/backend/${id}`) {
      throw new Error('MQTT_FLESPI_READONLY_RPC_NOT_CONFIGURED');
    }

    const requestTopic = this.mqtt.topics.control(id);
    const responseTopic = `${source}/rpc`;
    const requestId = randomBytes(4).readUInt32BE(0);
    const client = connect(broker, {
      ...this.mqtt.clientOptions('status'),
      clientId: `smarthome-read-${randomBytes(8).toString('hex')}`,
      clean: true,
      reconnectPeriod: 0,
      resubscribe: false,
      connectTimeout: 5000,
      rejectUnauthorized: true,
    });

    return new Promise<FlespiShellySwitchStatus>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, status?: FlespiShellySwitchStatus) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.end(true);
        if (error || !status) reject(error ?? new Error('MQTT_RPC_EMPTY_RESPONSE'));
        else resolve(status);
      };
      const timer = setTimeout(() =>
        finish(new Error('MQTT_FLESPI_RPC_TIMEOUT')), 10000);

      client.once('connect', () => {
        client.subscribe(responseTopic, { qos: 1 }, (error, granted) => {
          if (settled) return;
          if (error || !granted?.some((grant) =>
            grant.topic === responseTopic && grant.qos !== 128)) {
            finish(new Error('MQTT_FLESPI_RPC_SUBSCRIBE_DENIED'));
            return;
          }
          // Subscribe BEFORE publish to prevent racing the Shelly reply.
          client.publish(requestTopic, JSON.stringify({
            id: requestId,
            src: source,
            method: 'Switch.GetStatus',
            params: { id: config.switchId },
          }), { qos: 1, retain: false }, (publishError) => {
            if (publishError) finish(new Error('MQTT_FLESPI_RPC_PUBLISH_FAILED'));
          });
        });
      });

      client.on('message', (topic, payload, packet) => {
        if (settled || packet.retain || topic !== responseTopic) return;
        let frame: unknown;
        try { frame = JSON.parse(payload.toString('utf8')); }
        catch { return; }
        if (!isRecord(frame) || frame.id !== requestId) return;
        // Both identifiers are part of Shelly RPC response envelopes.
        // Never accept another device or an unrelated response.
        if (frame.src !== id || frame.dst !== source) return;
        if (isRecord(frame.error)) {
          finish(new Error('MQTT_FLESPI_RPC_DEVICE_ERROR'));
          return;
        }
        if (!isRecord(frame.result) || frame.result.id !== config.switchId ||
            typeof frame.result.output !== 'boolean') {
          finish(new Error('MQTT_FLESPI_RPC_INVALID_RESULT'));
          return;
        }
        const status = frame.result;
        finish(undefined, {
          output: status.output as boolean,
          powerW: optionalNonnegative(status.apower),
          voltageV: optionalNonnegative(status.voltage),
          currentA: optionalNonnegative(status.current),
          energyTotalWh: isRecord(status.aenergy)
            ? optionalNonnegative(status.aenergy.total) : undefined,
          receivedAt: new Date(),
        });
      });
      client.once('error', () => finish(new Error('MQTT_FLESPI_RPC_CONNECTION_FAILED')));
      client.once('close', () => finish(new Error('MQTT_FLESPI_RPC_CONNECTION_CLOSED')));
    });
  }
}
