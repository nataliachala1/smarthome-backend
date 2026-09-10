import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';
import { RealtimeEventsService } from '../../../realtime/realtime-events.service';

export type NotificationStatusToUpdate = 'READ' | 'DISMISSED';

export interface UpdateNotificationStatusInput {
  userId: string;
  notificationId: string;
  status: NotificationStatusToUpdate;
}

@Injectable()
export class UpdateNotificationStatusUseCase {
  constructor(
    private readonly prismaRls: PrismaRlsService,
    private readonly realtimeEventsService: RealtimeEventsService,
  ) {}

  async execute(input: UpdateNotificationStatusInput) {
    return await this.prismaRls.withUserContext(input.userId, async (tx) => {
      const existing = await tx.notification.findFirst({
        where: {
          id_notification: input.notificationId,
          id_user: input.userId,
        },
        select: {
          id_notification: true,
        },
      });

      if (!existing) {
        throw new NotFoundException('Notificación no encontrada');
      }

      const updated = await tx.notification.update({
        where: {
          id_notification: input.notificationId,
        },
        data: {
          status: input.status,
          updated_at: new Date(),
        },
        include: {
          device: {
            select: {
              name: true,
              manufacturer_device_id: true,
            },
          },
          home: {
            select: {
              name: true,
            },
          },
        },
      });

      const unreadCount = await tx.notification.count({
        where: {
          id_user: input.userId,
          status: 'UNREAD',
        },
    });

      this.realtimeEventsService.emitToUser(
        input.userId,
        'notification.unread_count.updated',
        {
          unreadCount,
        },
      );

      return {
        id: updated.id_notification,
        userId: updated.id_user,
        alertId: updated.id_alert,
        homeId: updated.id_home,
        homeName: updated.home?.name ?? null,
        deviceId: updated.id_device,
        deviceName: updated.device?.name ?? null,
        manufacturerDeviceId: updated.device?.manufacturer_device_id ?? null,
        type: updated.type,
        title: updated.title,
        message: updated.message,
        status: updated.status,
        priority: updated.priority,
        channel: updated.channel,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      };
    });
  }
}