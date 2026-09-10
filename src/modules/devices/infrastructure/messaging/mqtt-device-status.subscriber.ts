import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, IClientOptions, MqttClient } from 'mqtt';

import { PrismaService } from '../../../../infrastructure/database/prisma/prisma.service';
import { Prisma } from '../../../../../generated/prisma/client';
import { RealtimeEventsService } from '../../../realtime/realtime-events.service';

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

interface UpdatedDeviceStatus {
  id_device: string;
  id_home: string;
  connectivity_status: DeviceConnectivityStatus;
  is_on: boolean;
  current_power_w: Prisma.Decimal | null;
  updated_at: Date;
}

interface CreatedNotification {
  id_notification: string;
  id_user: string;
  id_alert: string | null;
  id_home: string | null;
  id_device: string | null;
  type: string;
  title: string;
  message: string;
  status: string;
  priority: string;
  channel: string;
  created_at: Date;
  updated_at: Date;
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
    private readonly realtimeEventsService: RealtimeEventsService,
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
      void this.handleStatusMessage(topic, payload).catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Error desconocido';

        this.logger.error(
          `No se pudo procesar mensaje MQTT de estado: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    });

    client.on('error', (error) => {
      this.logger.error(`Error MQTT de estado: ${error.message}`);
    });

    client.on('reconnect', () => {
      this.logger.warn('Reconectando al broker MQTT...');
    });

    client.on('offline', () => {
      this.logger.warn('Cliente MQTT sin conexión.');
    });

    client.on('close', () => {
      this.logger.warn('Conexión MQTT cerrada.');
    });
  }

  onModuleDestroy(): void {
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
  }

  private async handleStatusMessage(
    topic: string,
    payload: Buffer,
  ): Promise<void> {
    const manufacturerDeviceId =
      this.extractManufacturerDeviceId(topic);

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
    name: true,
    manufacturer_device_id: true,
    },
  });

    if (!device) {
      this.logger.warn(
        `No se encontró dispositivo activo para manufacturerDeviceId=${manufacturerDeviceId}`,
      );
      return;
    }

    const now = new Date();

    const readAt = message.readAt
      ? new Date(message.readAt)
      : now;

    const metricStartAt = this.getUtcDayStart(readAt);
    const metricEndAt = this.addDays(metricStartAt, 1);

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

    const shouldCreateConsumption =
      typeof powerW === 'number';

    const transactionResult = await this.prisma.$transaction(
      async (tx) => {
        const updatedDevice = await tx.device.update({
          where: {
            id_device: device.id_device,
          },
          data: deviceData,
          select: {
            id_device: true,
            id_home: true,
            connectivity_status: true,
            is_on: true,
            current_power_w: true,
            updated_at: true,
          },
        });

        const recipients = await this.findHomeRealtimeRecipients(
          tx,
          device.id_home,
        );

        const notifications: CreatedNotification[] = [];

        if (shouldCreateConsumption && powerW !== undefined) {
          const createdConsumption = await tx.consumption.create({
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
    id_device: true,
    id_home: true,
    power_w: true,
    energy_delta_kwh: true,
    energy_total_kwh: true,
    voltage_v: true,
    current_a: true,
    frequency_hz: true,
    temperature_c: true,
    read_at: true,
  },
});

const consumptionRecipients = await this.findHomeRealtimeRecipients(
  tx,
  device.id_home,
);

for (const recipient of consumptionRecipients) {
  this.realtimeEventsService.emitToUser(
    recipient.id_user,
    'consumption.created',
    {
      id: createdConsumption.id_consumption,
      homeId: createdConsumption.id_home,
      deviceId: createdConsumption.id_device,
      deviceName: device.name,
      manufacturerDeviceId: device.manufacturer_device_id,
      powerW: Number(createdConsumption.power_w),
      energyDeltaKwh: Number(createdConsumption.energy_delta_kwh),
      energyTotalKwh:
        createdConsumption.energy_total_kwh === null
          ? null
          : Number(createdConsumption.energy_total_kwh),
      voltageV:
        createdConsumption.voltage_v === null
          ? null
          : Number(createdConsumption.voltage_v),
      currentA:
        createdConsumption.current_a === null
          ? null
          : Number(createdConsumption.current_a),
      frequencyHz:
        createdConsumption.frequency_hz === null
          ? null
          : Number(createdConsumption.frequency_hz),
      temperatureC:
        createdConsumption.temperature_c === null
          ? null
          : Number(createdConsumption.temperature_c),
      readAt: createdConsumption.read_at,
    },
  );
}

          await this.refreshDailyDeviceMetric(
            tx,
            device.id_device,
            device.id_home,
            metricStartAt,
            metricEndAt,
          );

          const anomalyNotifications =
            await this.evaluateDailyConsumptionAnomaly(
              tx,
              device.id_device,
              device.id_home,
              metricStartAt,
              metricEndAt,
            );

          notifications.push(...anomalyNotifications);
        }

        return {
          updatedDevice,
          recipients,
          notifications,
        };
      },
    );

    /*
     * Los eventos se emiten DESPUÉS de que la transacción termina
     * correctamente. Así evitamos enviar eventos de datos que luego
     * podrían ser revertidos por un rollback.
     */
    for (const recipient of transactionResult.recipients) {
      this.realtimeEventsService.emitToUser(
        recipient.id_user,
        'device.status.updated',
        {
          id: transactionResult.updatedDevice.id_device,
          homeId: transactionResult.updatedDevice.id_home,
          connectivityStatus:
            transactionResult.updatedDevice.connectivity_status,
          isOn: transactionResult.updatedDevice.is_on,
          currentPowerW:
            transactionResult.updatedDevice.current_power_w === null
              ? null
              : Number(
                  transactionResult.updatedDevice.current_power_w,
                ),
          updatedAt: transactionResult.updatedDevice.updated_at,
        },
      );
    }

    for (const notification of transactionResult.notifications) {
      this.realtimeEventsService.emitToUser(
        notification.id_user,
        'notification.created',
        {
          id: notification.id_notification,
          userId: notification.id_user,
          alertId: notification.id_alert,
          homeId: notification.id_home,
          deviceId: notification.id_device,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          status: notification.status,
          priority: notification.priority,
          channel: notification.channel,
          createdAt: notification.created_at,
          updatedAt: notification.updated_at,
        },
      );

      const unreadCount = await this.prisma.notification.count({
        where: {
          id_user: notification.id_user,
          status: 'UNREAD',
        },
      });

      this.realtimeEventsService.emitToUser(
        notification.id_user,
        'notification.unread_count.updated',
        {
          unreadCount,
        },
      );
    }

    this.logger.log(
      `Estado MQTT actualizado para ${manufacturerDeviceId}. Consumo guardado=${shouldCreateConsumption}`,
    );
  }

  private extractManufacturerDeviceId(
    topic: string,
  ): string | null {
    const parts = topic.split('/');

    // smarthome/devices/{manufacturerDeviceId}/status
    if (parts.length !== 4) {
      return null;
    }

    if (
      parts[0] !== 'smarthome' ||
      parts[1] !== 'devices'
    ) {
      return null;
    }

    if (parts[3] !== 'status') {
      return null;
    }

    return parts[2]?.trim() || null;
  }

  private parsePayload(
    payload: Buffer,
  ): DeviceStatusMessage | null {
    try {
      const rawPayload = payload.toString('utf8');
      const parsed = JSON.parse(rawPayload) as unknown;

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return null;
      }

      const message = parsed as DeviceStatusMessage;

      const hasAtLeastOneSupportedField =
        message.connectivityStatus !== undefined ||
        message.isOn !== undefined ||
        message.currentPowerW !== undefined ||
        message.energyDeltaKwh !== undefined ||
        message.energyTotalKwh !== undefined ||
        message.voltageV !== undefined ||
        message.currentA !== undefined ||
        message.frequencyHz !== undefined ||
        message.temperatureC !== undefined;

      if (!hasAtLeastOneSupportedField) {
        return null;
      }

      if (
        message.connectivityStatus !== undefined &&
        !['ONLINE', 'OFFLINE'].includes(
          message.connectivityStatus,
        )
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

      if (
        !this.isValidOptionalNumber(
          message.energyDeltaKwh,
        )
      ) {
        return null;
      }

      if (
        !this.isValidOptionalNumber(
          message.energyTotalKwh,
        )
      ) {
        return null;
      }

      if (!this.isValidOptionalNumber(message.voltageV)) {
        return null;
      }

      if (!this.isValidOptionalNumber(message.currentA)) {
        return null;
      }

      if (
        !this.isValidOptionalNumber(
          message.frequencyHz,
        )
      ) {
        return null;
      }

      if (
        !this.isValidOptionalNumber(
          message.temperatureC,
        )
      ) {
        return null;
      }

      if (message.readAt !== undefined) {
        if (typeof message.readAt !== 'string') {
          return null;
        }

        if (
          Number.isNaN(
            new Date(message.readAt).getTime(),
          )
        ) {
          return null;
        }
      }

      return message;
    } catch {
      return null;
    }
  }

  private isValidOptionalNumber(
    value: unknown,
  ): boolean {
    return (
      value === undefined ||
      value === null ||
      (typeof value === 'number' &&
        Number.isFinite(value))
    );
  }

  private getUtcDayStart(value: Date): Date {
    return new Date(
      Date.UTC(
        value.getUTCFullYear(),
        value.getUTCMonth(),
        value.getUTCDate(),
      ),
    );
  }

  private addDays(
    value: Date,
    days: number,
  ): Date {
    const result = new Date(value);

    result.setUTCDate(
      result.getUTCDate() + days,
    );

    return result;
  }

  private async refreshDailyDeviceMetric(
    tx: Prisma.TransactionClient,
    deviceId: string,
    homeId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<void> {
    const aggregate =
      await tx.consumption.aggregate({
        where: {
          id_device: deviceId,
          id_home: homeId,
          read_at: {
            gte: startAt,
            lt: endAt,
          },
        },
        _sum: {
          energy_delta_kwh: true,
        },
        _avg: {
          power_w: true,
        },
        _max: {
          power_w: true,
        },
        _min: {
          power_w: true,
        },
      });

    const metricData = {
      end_at: endAt,
      kwh_total:
        aggregate._sum.energy_delta_kwh ?? 0,
      average_watts: aggregate._avg.power_w,
      max_watts: aggregate._max.power_w,
      min_watts: aggregate._min.power_w,
      updated_at: new Date(),
    };

    const existingMetric =
      await tx.consumption_metric.findFirst({
        where: {
          id_device: deviceId,
          period: 'dia',
          start_at: startAt,
        },
        select: {
          id_consumption_metric: true,
        },
      });

    if (existingMetric) {
      await tx.consumption_metric.update({
        where: {
          id_consumption_metric:
            existingMetric.id_consumption_metric,
        },
        data: metricData,
      });

      return;
    }

    await tx.consumption_metric.create({
      data: {
        id_device: deviceId,
        id_home: homeId,
        period: 'dia',
        start_at: startAt,
        ...metricData,
      },
    });
  }

  private async evaluateDailyConsumptionAnomaly(
    tx: Prisma.TransactionClient,
    deviceId: string,
    homeId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<CreatedNotification[]> {
    const metric = await tx.consumption_metric.findFirst({
      where: {
        id_device: deviceId,
        id_home: homeId,
        period: 'dia',
        start_at: startAt,
      },
      select: {
        kwh_total: true,
      },
    });

    if (!metric) {
      return [];
    }

    const currentDailyKwh = Number(metric.kwh_total);

    if (currentDailyKwh <= 0) {
      return [];
    }

    const historyStartAt = this.addDays(startAt, -7);

    const historicalMetrics =
      await tx.consumption_metric.findMany({
        where: {
          id_device: deviceId,
          id_home: homeId,
          period: 'dia',
          start_at: {
            gte: historyStartAt,
            lt: startAt,
          },
        },
        select: {
          kwh_total: true,
          start_at: true,
        },
      });

    if (historicalMetrics.length === 0) {
      return [];
    }

    const historicalAverageKwh =
      historicalMetrics.reduce(
        (total, historicalMetric) =>
          total + Number(historicalMetric.kwh_total),
        0,
      ) / historicalMetrics.length;

    if (historicalAverageKwh <= 0) {
      return [];
    }

    const expectedMaxKwh =
      historicalAverageKwh * 1.5;

    if (currentDailyKwh <= expectedMaxKwh) {
      return [];
    }

    const existingAlert = await tx.alert.findFirst({
      where: {
        id_device: deviceId,
        id_home: homeId,
        alert_type: 'ANOMALY',
        created_at: {
          gte: startAt,
          lt: endAt,
        },
      },
      select: {
        id_alert: true,
      },
    });

    if (existingAlert) {
      return [];
    }

    const createdAlert = await tx.alert.create({
      data: {
        id_alert_rule: null,
        id_device: deviceId,
        id_home: homeId,
        alert_type: 'ANOMALY',
        detected_value: currentDailyKwh.toFixed(6),
        limit_value: expectedMaxKwh.toFixed(6),
        action_executed: 'alert',
        metadata: {
          reason: 'daily_consumption_anomaly',
          period: 'dia',
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          currentDailyKwh,
          historicalAverageKwh,
          expectedMaxKwh,
          historicalDays: historicalMetrics.length,
          comparisonWindowDays: 7,
        },
      },
      select: {
        id_alert: true,
      },
    });

    const recipients =
      await this.findHomeRealtimeRecipients(
        tx,
        homeId,
      );

    if (recipients.length === 0) {
      return [];
    }

    const notifications: CreatedNotification[] = [];

    for (const recipient of recipients) {
      const notification =
        await tx.notification.create({
          data: {
            id_user: recipient.id_user,
            id_alert: createdAlert.id_alert,
            id_home: homeId,
            id_device: deviceId,
            type: 'ALERT',
            title: 'Consumo anómalo detectado',
            message:
              `El dispositivo está consumiendo más energía de lo habitual. ` +
              `Consumo actual: ${currentDailyKwh.toFixed(6)} kWh. ` +
              `Promedio histórico: ${historicalAverageKwh.toFixed(6)} kWh.`,
            status: 'UNREAD',
            priority: 'alta',
            channel: 'IN_APP',
          },
          select: {
            id_notification: true,
            id_user: true,
            id_alert: true,
            id_home: true,
            id_device: true,
            type: true,
            title: true,
            message: true,
            status: true,
            priority: true,
            channel: true,
            created_at: true,
            updated_at: true,
          },
        });

      notifications.push(notification);
    }

    return notifications;
  }

  private async findHomeRealtimeRecipients(
    tx: Prisma.TransactionClient,
    homeId: string,
  ): Promise<{ id_user: string }[]> {
    return tx.$queryRaw<{ id_user: string }[]>`
      SELECT DISTINCT recipient.id_user
      FROM (
        SELECT h.created_by AS id_user
        FROM homes.home h
        WHERE h.id_home = ${homeId}::uuid

        UNION

        SELECT hm.id_user AS id_user
        FROM homes.home_member hm
        WHERE hm.id_home = ${homeId}::uuid
          AND hm.status = 'ACTIVE'
      ) recipient
      WHERE recipient.id_user IS NOT NULL
    `;
  }
}