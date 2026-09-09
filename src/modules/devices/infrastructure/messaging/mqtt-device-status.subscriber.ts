import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, IClientOptions, MqttClient } from 'mqtt';

import { PrismaService } from '../../../../infrastructure/database/prisma/prisma.service';

type DeviceConnectivityStatus = 'ONLINE' | 'OFFLINE';

interface DeviceStatusMessage {
  connectivityStatus?: DeviceConnectivityStatus;
  isOn?: boolean;
  currentPowerW?: number | null;
  energyDeltaKwh?: number | null;
  energyTotalKwh?: number | null;
  voltageV?: number | null;
  currentA?: number | null;
  frequencyHz?: number | null;
  temperatureC?: number | null;
  readAt?: string;
}

@Injectable()
export class MqttDeviceStatusSubscriber
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MqttDeviceStatusSubscriber.name);
  private client: MqttClient | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    const brokerUrl = this.configService.get<string>('MQTT_BROKER_URL');

    if (!brokerUrl) {
      this.logger.warn(
        'MQTT_BROKER_URL no está configurado. No se iniciará el subscriber MQTT.',
      );
      return;
    }

    const options: IClientOptions = {
      clientId:
        this.configService.get<string>('MQTT_STATUS_CLIENT_ID') ??
        `smarthome-backend-status-${process.pid}`,
      username: this.configService.get<string>('MQTT_USERNAME') || undefined,
      password: this.configService.get<string>('MQTT_PASSWORD') || undefined,
      clean: true,
      reconnectPeriod: 1000,
      connectTimeout: 5000,
    };

    const client = connect(brokerUrl, options);
    this.client = client;

    client.on('connect', () => {
      const topic =
        this.configService.get<string>('MQTT_STATUS_TOPIC_FILTER') ??
        'smarthome/devices/+/status';

      client.subscribe(topic, { qos: 1 }, (error) => {
        if (error) {
          this.logger.error(
            `No se pudo suscribir al tópico MQTT de estado: ${error.message}`,
          );
          return;
        }

        this.logger.log(`Suscrito a tópico MQTT de estado: ${topic}`);
      });
    });

    client.on('message', (topic, payload) => {
      void this.handleStatusMessage(topic, payload).catch(
        (error: unknown) => {
          const message =
            error instanceof Error ? error.message : 'Error desconocido';

          this.logger.error(
            `No se pudo procesar mensaje MQTT de estado: ${message}`,
          );
        },
      );
    });

    client.on('error', (error) => {
      this.logger.error(`Error MQTT de estado: ${error.message}`);
    });
  }

  onModuleDestroy(): void {
    this.client?.end(true);
    this.client = null;
  }

  private async handleStatusMessage(
    topic: string,
    payload: Buffer,
  ): Promise<void> {
    const manufacturerDeviceId = this.extractManufacturerDeviceId(topic);

    if (!manufacturerDeviceId) {
      this.logger.warn(`Tópico MQTT de estado inválido: ${topic}`);
      return;
    }

    const message = this.parsePayload(payload);

    if (!message) {
      this.logger.warn(
        `Payload MQTT de estado inválido para ${manufacturerDeviceId}`,
      );
      return;
    }

    const device = await this.prisma.device.findFirst({
      where: {
        manufacturer_device_id: manufacturerDeviceId,
        status: 'ACTIVE',
        deleted_at: null,
      },
      select: {
        id_device: true,
        id_home: true,
      },
    });

    if (!device) {
      this.logger.warn(
        `No se encontró dispositivo activo para manufacturerDeviceId=${manufacturerDeviceId}`,
      );
      return;
    }

    const now = new Date();
    const readAt = message.readAt ? new Date(message.readAt) : now;

    const deviceData: {
      connectivity_status?: DeviceConnectivityStatus;
      is_on?: boolean;
      current_power_w?: number | null;
      updated_at: Date;
    } = {
      updated_at: now,
    };

    if (message.connectivityStatus !== undefined) {
      deviceData.connectivity_status = message.connectivityStatus;
    }

    if (message.isOn !== undefined) {
      deviceData.is_on = message.isOn;
    }

    if (message.currentPowerW !== undefined) {
      deviceData.current_power_w = message.currentPowerW;
    }

    const powerW = message.currentPowerW;
    const shouldCreateConsumption = typeof powerW === 'number';

    await this.prisma.$transaction(async (tx) => {
      await tx.device.update({
        where: {
          id_device: device.id_device,
        },
        data: deviceData,
      });

      if (!shouldCreateConsumption) {
        return;
      }

      await tx.consumption.create({
        data: {
          id_device: device.id_device,
          id_home: device.id_home,
          power_w: powerW,
          energy_delta_kwh: message.energyDeltaKwh ?? 0,
          energy_total_kwh: message.energyTotalKwh ?? null,
          voltage_v: message.voltageV ?? null,
          current_a: message.currentA ?? null,
          frequency_hz: message.frequencyHz ?? null,
          temperature_c: message.temperatureC ?? null,
          read_at: readAt,
        },
        select: {
          id_consumption: true,
          read_at: true,
        },
      });
    });

    this.logger.log(
      `Estado MQTT actualizado para ${manufacturerDeviceId}. Consumo guardado=${shouldCreateConsumption}`,
    );
  }

  private extractManufacturerDeviceId(topic: string): string | null {
    const parts = topic.split('/');

    // smarthome/devices/{manufacturerDeviceId}/status
    if (parts.length !== 4) {
      return null;
    }

    if (parts[0] !== 'smarthome' || parts[1] !== 'devices') {
      return null;
    }

    if (parts[3] !== 'status') {
      return null;
    }

    return parts[2] || null;
  }

  private parsePayload(payload: Buffer): DeviceStatusMessage | null {
    try {
      const rawPayload = payload.toString('utf8');
      const parsed = JSON.parse(rawPayload) as unknown;

      if (typeof parsed !== 'object' || parsed === null) {
        return null;
      }

      const message = parsed as DeviceStatusMessage;

      if (
        message.connectivityStatus !== undefined &&
        !['ONLINE', 'OFFLINE'].includes(message.connectivityStatus)
      ) {
        return null;
      }

      if (
        message.isOn !== undefined &&
        typeof message.isOn !== 'boolean'
      ) {
        return null;
      }

      if (!this.isValidOptionalNumber(message.currentPowerW)) {
        return null;
      }

      if (!this.isValidOptionalNumber(message.energyDeltaKwh)) {
        return null;
      }

      if (!this.isValidOptionalNumber(message.energyTotalKwh)) {
        return null;
      }

      if (!this.isValidOptionalNumber(message.voltageV)) {
        return null;
      }

      if (!this.isValidOptionalNumber(message.currentA)) {
        return null;
      }

      if (!this.isValidOptionalNumber(message.frequencyHz)) {
        return null;
      }

      if (!this.isValidOptionalNumber(message.temperatureC)) {
        return null;
      }

      if (message.readAt !== undefined) {
        if (typeof message.readAt !== 'string') {
          return null;
        }

        if (Number.isNaN(new Date(message.readAt).getTime())) {
          return null;
        }
      }

      return message;
    } catch {
      return null;
    }
  }

  private isValidOptionalNumber(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      (typeof value === 'number' && Number.isFinite(value))
    );
  }
}