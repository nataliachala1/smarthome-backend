import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../infrastructure/database/prisma/prisma.service';

import { AccountActivationRepository } from '../../domain/repositories/account-activation.repository';

@Injectable()
export class PrismaAccountActivationRepository
  implements AccountActivationRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async activateAccount(
    userId: string,
    recoveryTokenId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: {
          id_user: userId,
        },
        data: {
          status: 'ACTIVE',
          email_verified: true,
          failed_login_attempts: 0,
          locked_until: null,
        },
      });

      await tx.recovery_token.update({
        where: {
          id_recovery_token: recoveryTokenId,
        },
        data: {
          used_at: new Date(),
        },
      });
    });
  }
}