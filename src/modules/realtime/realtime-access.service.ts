import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaRlsService } from '../../infrastructure/database/prisma/prisma-rls.service';

@Injectable()
export class RealtimeAccessService {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  async canReceive(
    userId: string,
    event: string,
    payload: unknown,
  ): Promise<boolean> {
    if (!payload || typeof payload !== 'object') return false;
    const data = payload as Record<string, unknown>;
    if (event === 'notification.unread_count.updated') {
      return (
        typeof data.unreadCount === 'number' &&
        Number.isSafeInteger(data.unreadCount) &&
        data.unreadCount >= 0
      );
    }
    if (
      ![
        'consumption.created',
        'device.status.updated',
        'notification.created',
      ].includes(event)
    )
      return false;
    if (event === 'notification.created') {
      if (data.userId !== userId) return false;
      if (data.homeId === null) return data.deviceId === null;
    }
    if (typeof data.homeId !== 'string' || !isUUID(data.homeId)) return false;
    const homeId = data.homeId;
    return this.prismaRls.withUserContext(userId, async (tx) => {
      const membership = await tx.home_member.findFirst({
        where: {
          id_user: userId,
          id_home: homeId,
          status: 'ACTIVE',
          accepted_at: { not: null },
          ended_at: null,
          role: { in: ['OWNER', 'MEMBER'] },
          home: { status: 'ACTIVE', deleted_at: null },
        },
        select: { id_home_member: true },
      });
      return membership !== null;
    });
  }
}
