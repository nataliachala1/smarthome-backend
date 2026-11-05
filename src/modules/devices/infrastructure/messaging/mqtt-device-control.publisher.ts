import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { connect, MqttClient } from 'mqtt';
import { MqttRuntimeService } from './mqtt-runtime.service';

import {
  DeviceControlPublisher,
  PublishDeviceControlCommandInput,
} from '../../domain/services/device-control-publisher';

import {
  DeviceControlPublisherUnavailableError,
  DeviceControlNotConfiguredError,
} from '../../domain/errors/device-control.error';
import { mqttDeviceId } from '../../../../config/mqtt-config';

interface MqttControlMessage {
  topic: string;
  payload: string;
}

@Injectable()
export class MqttDeviceControlPublisher
  extends DeviceControlPublisher
  implements OnModuleDestroy
{
  private client: MqttClient | null = null;
  private connecting: Promise<MqttClient> | null = null;

  constructor(private readonly mqtt: MqttRuntimeService) {
    super();
  }

  async publishControlCommand(
    input: PublishDeviceControlCommandInput,
  ): Promise<void> {
    if (!mqttDeviceId.test(input.manufacturerDeviceId)) {
      throw new DeviceControlNotConfiguredError();
    }
    const { topic, payload } = this.buildControlMessage(input);
    const client = await this.getClient();

    await new Promise<void>((resolve, reject) => {
      client.publish(topic, payload, { qos: 1, retain: false }, (error) => {
        if (error) {
          reject(new DeviceControlPublisherUnavailableError());
          return;
        }

        resolve();
      });
    });
  }

  private buildControlMessage(
    input: PublishDeviceControlCommandInput,
  ): MqttControlMessage {
    if (this.isShellyDevice(input.manufacturerDeviceId)) {
      return this.buildShellyControlMessage(input);
    }

    return this.buildSmartHomeControlMessage(input);
  }

  private buildSmartHomeControlMessage(
    input: PublishDeviceControlCommandInput,
  ): MqttControlMessage {
    const topic = this.mqtt.topics.control(input.manufacturerDeviceId);

    const payload = JSON.stringify({
      command: input.action,
      homeId: input.homeId,
      deviceId: input.deviceId,
      manufacturerDeviceId: input.manufacturerDeviceId,
      sentAt: new Date().toISOString(),
    });

    return {
      topic,
      payload,
    };
  }

  private buildShellyControlMessage(
    input: PublishDeviceControlCommandInput,
  ): MqttControlMessage {
    const topic = this.mqtt.topics.control(input.manufacturerDeviceId);

    const payload = JSON.stringify({
      id: Date.now(),
      src: this.mqtt.config.rpcSource,
      method: 'Switch.Set',
      params: {
        id: this.mqtt.config.switchId,
        on: input.action === 'TURN_ON',
      },
    });

    return {
      topic,
      payload,
    };
  }

  private isShellyDevice(manufacturerDeviceId: string): boolean {
    return manufacturerDeviceId.toLowerCase().startsWith('shelly');
  }

  private async getClient(): Promise<MqttClient> {
    if (this.client?.connected) {
      return this.client;
    }
    if (this.connecting) return this.connecting;

    // Reuse the existing client while MQTT.js reconnects; concurrent HTTP
    // commands must not create connections that evict one another's clientId.
    this.connecting = this.waitForClient().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async waitForClient(): Promise<MqttClient> {
    const brokerUrl = this.mqtt.config.brokerUrl;

    if (!brokerUrl) {
      throw new DeviceControlPublisherUnavailableError();
    }

    let client: MqttClient;
    try {
      client =
        this.client ?? connect(brokerUrl, this.mqtt.clientOptions('control'));
    } catch {
      throw new DeviceControlPublisherUnavailableError();
    }
    this.client = client;

    return await new Promise<MqttClient>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        client.off('connect', success);
        client.off('error', fail);
      };

      const fail = () => {
        if (settled) return;

        settled = true;
        cleanup();
        client.end(true);

        if (this.client === client) {
          this.client = null;
        }

        reject(new DeviceControlPublisherUnavailableError());
      };

      const success = () => {
        if (settled) return;

        settled = true;
        cleanup();
        resolve(client);
      };

      const timeout = setTimeout(fail, 5000);

      client.once('connect', success);
      client.once('error', fail);
    });
  }

  onModuleDestroy(): void {
    this.client?.end(true);
    this.client = null;
  }
}
