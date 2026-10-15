import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaIotService } from '../../../../infrastructure/database/prisma/prisma-iot.service';
import { RealtimeEventsService } from '../../../realtime/realtime-events.service';

interface RealtimeRecipient {
  id_user: string;
}

@Injectable()
export class DeviceOfflineWatcherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DeviceOfflineWatcherService.name);
  private timer: NodeJS.Timeout | null = null;

  private readonly timeoutSeconds = Number(
    process.env.DEVICE_OFFLINE_TIMEOUT_SECONDS ?? 60,
  );

  private readonly intervalSeconds = Number(
    process.env.DEVICE_OFFLINE_WATCH_INTERVAL_SECONDS ?? 30,
  );

  constructor(
    private readonly prisma: PrismaIotService,
    private readonly realtimeEventsService: RealtimeEventsService,
  ) {}

  onModuleInit(): void {
    if (this.timeoutSeconds <= 0 || this.intervalSeconds <= 0) {
      this.logger.warn(
        'Device offline watcher deshabilitado por configuración inválida',
      );
      return;
    }

    this.logger.log(
      `Device offline watcher activo. timeout=${this.timeoutSeconds}s interval=${this.intervalSeconds}s`,
    );

    this.timer = setInterval(() => {
      void this.checkOfflineDevices();
    }, this.intervalSeconds * 1000);

    void this.checkOfflineDevices();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async checkOfflineDevices(): Promise<void> {
    const threshold = new Date(
      Date.now() - this.timeoutSeconds * 1000,
    );

    const devices = await this.prisma.device.findMany({
      where: {
        status: 'ACTIVE',
        deleted_at: null,
        connectivity_status: 'ONLINE',
        OR: [
          {
            last_seen_at: null,
          },
          {
            last_seen_at: {
              lt: threshold,
            },
          },
        ],
      },
      select: {
        id_device: true,
        id_home: true,
        manufacturer_device_id: true,
        last_seen_at: true,
      },
    });

    if (devices.length === 0) {
      return;
    }

    this.logger.warn(
      `Dispositivos ONLINE vencidos detectados: ${devices.length}`,
    );

    for (const device of devices) {
      const updated = await this.prisma.device.update({
        where: {
          id_device: device.id_device,
        },
        data: {
          connectivity_status: 'OFFLINE',
          is_on: false,
          current_power_w: 0,
        },
        select: {
          id_device: true,
          id_home: true,
          connectivity_status: true,
          is_on: true,
          current_power_w: true,
          updated_at: true,
        },
      });

      this.logger.warn(
        `Dispositivo marcado OFFLINE: ${device.manufacturer_device_id}`,
      );

      const recipients = await this.findHomeRealtimeRecipients(
        updated.id_home,
      );

      for (const recipient of recipients) {
        this.realtimeEventsService.emitToUser(
          recipient.id_user,
          'device.status.updated',
          {
            id: updated.id_device,
            homeId: updated.id_home,
            connectivityStatus: updated.connectivity_status,
            isOn: updated.is_on,
            currentPowerW:
              updated.current_power_w === null
                ? null
                : Number(updated.current_power_w),
            updatedAt: updated.updated_at,
          },
        );
      }
    }
  }

  private async findHomeRealtimeRecipients(
    homeId: string,
  ): Promise<RealtimeRecipient[]> {
    return await this.prisma.$queryRaw<RealtimeRecipient[]>`
      SELECT h.created_by AS id_user
      FROM homes.home h
      WHERE h.id_home = ${homeId}::uuid
        AND h.status = 'ACTIVE'
        AND h.deleted_at IS NULL

      UNION

      SELECT hm.id_user
      FROM homes.home_member hm
      WHERE hm.id_home = ${homeId}::uuid
        AND hm.status = 'ACTIVE'
    `;
  }
}