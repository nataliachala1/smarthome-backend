import { Injectable } from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';
import { RealtimeEventsService } from '../../../realtime/realtime-events.service';

export interface MarkAllNotificationsAsReadInput {
  userId: string;
}

@Injectable()
export class MarkAllNotificationsAsReadUseCase {
  constructor(
    private readonly prismaRls: PrismaRlsService,
    private readonly realtimeEventsService: RealtimeEventsService,
  ) {}

  async execute(input: MarkAllNotificationsAsReadInput) {
  const result = await this.prismaRls.withUserContext(
    input.userId,
    async (tx) => {
      const updateResult = await tx.notification.updateMany({
        where: {
          id_user: input.userId,
          status: 'UNREAD',
        },
        data: {
          status: 'READ',
          updated_at: new Date(),
        },
      });

      const unreadCount = await tx.notification.count({
        where: {
          id_user: input.userId,
          status: 'UNREAD',
        },
      });

      return {
        updatedCount: updateResult.count,
        unreadCount,
      };
    },
  );

  this.realtimeEventsService.emitToUser(
    input.userId,
    'notification.unread_count.updated',
    {
      unreadCount: result.unreadCount,
    },
  );

  return {
    updatedCount: result.updatedCount,
  };
}
}