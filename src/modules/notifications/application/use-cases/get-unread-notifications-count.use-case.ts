import { Injectable } from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

export interface GetUnreadNotificationsCountInput {
  userId: string;
}

@Injectable()
export class GetUnreadNotificationsCountUseCase {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  async execute(input: GetUnreadNotificationsCountInput) {
    const unreadCount = await this.prismaRls.withUserContext(
      input.userId,
      async (tx) =>
        tx.notification.count({
          where: {
            id_user: input.userId,
            status: 'UNREAD',
          },
        }),
    );

    return {
      unreadCount,
    };
  }
}