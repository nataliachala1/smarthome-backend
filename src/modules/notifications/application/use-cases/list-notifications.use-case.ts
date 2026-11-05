import { Injectable } from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

export interface ListNotificationsInput {
  userId: string;
  status?: 'UNREAD' | 'READ' | 'DISMISSED';
  limit?: number;
}

@Injectable()
export class ListNotificationsUseCase {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  async execute(input: ListNotificationsInput) {
    const limit = input.limit ?? 20;

    const rows = await this.prismaRls.withUserContext(input.userId, async (tx) =>
      tx.notification.findMany({
        where: {
          id_user: input.userId,
          ...(input.status ? { status: input.status } : {}),
        },
        orderBy: {
          created_at: 'desc',
        },
        take: limit,
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
      }),
    );

    return rows.map((row) => ({
      id: row.id_notification,
      userId: row.id_user,
      alertId: row.id_alert,
      homeId: row.id_home,
      homeName: row.home?.name ?? null,
      deviceId: row.id_device,
      deviceName: row.device?.name ?? null,
      manufacturerDeviceId: row.device?.manufacturer_device_id ?? null,
      type: row.type,
      title: row.title,
      message: row.message,
      status: row.status,
      priority: row.priority,
      channel: row.channel,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}