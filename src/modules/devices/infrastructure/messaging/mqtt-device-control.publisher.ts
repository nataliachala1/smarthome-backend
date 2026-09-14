import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, IClientOptions, MqttClient } from 'mqtt';

import {
  DeviceControlPublisher,
  PublishDeviceControlCommandInput,
} from '../../domain/services/device-control-publisher';

import { DeviceControlPublisherUnavailableError } from '../../domain/errors/device-control.error';

@Injectable()
export class MqttDeviceControlPublisher
  extends DeviceControlPublisher
  implements OnModuleDestroy
{
  private client: MqttClient | null = null;

  constructor(private readonly configService: ConfigService) {
    super();
  }

  async publishControlCommand(
    input: PublishDeviceControlCommandInput,
  ): Promise<void> {
    const client = await this.getClient();

    const topicPrefix =
      this.configService.get<string>('MQTT_CONTROL_TOPIC_PREFIX') ??
      'smarthome/devices';

    const topic = `${topicPrefix}/${input.manufacturerDeviceId}/control`;

    const payload = JSON.stringify({
      command: input.action,
      homeId: input.homeId,
      deviceId: input.deviceId,
      manufacturerDeviceId: input.manufacturerDeviceId,
      sentAt: new Date().toISOString(),
    });

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

    private async getClient(): Promise<MqttClient> {
    if (this.client?.connected) {
        return this.client;
    }

    const brokerUrl = this.configService.get<string>('MQTT_BROKER_URL');

    if (!brokerUrl) {
        throw new DeviceControlPublisherUnavailableError();
    }

    const options: IClientOptions = {
        clientId:
        this.configService.get<string>('MQTT_CLIENT_ID') ??
        `smarthome-backend-${process.pid}`,
        username: this.configService.get<string>('MQTT_USERNAME') || undefined,
        password: this.configService.get<string>('MQTT_PASSWORD') || undefined,
        clean: true,
        reconnectPeriod: 1000,
        connectTimeout: 5000,
    };

    const client = connect(brokerUrl, options);
    this.client = client;

    return await new Promise<MqttClient>((resolve, reject) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout>;

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

        timeout = setTimeout(fail, 5000);

        client.once('connect', success);
        client.once('error', fail);
    });
    }
    onModuleDestroy(): void {
    this.client?.end(true);
    this.client = null;
    }
}