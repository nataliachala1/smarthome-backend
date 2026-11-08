import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../infrastructure/database/prisma/prisma.service';
import { UserStatus } from '../../../users/domain/entities/user-status.enum';
import { RecoveryTokenType } from '../../domain/ports/recovery-token-type.enum';
import {
  AccountRegistrationRepository,
  PendingRegistrationData,
  RegisteredUser,
} from '../../domain/repositories/account-registration.repository';

interface InsertedUserRow {
  id_user: string;
  name: string;
  email: string;
  status: string;
  email_verified: boolean;
}

/** Leaves room for a slow SMTP server inside the registration transaction. */
const REGISTRATION_TRANSACTION_TIMEOUT_MS = 20_000;

@Injectable()
export class PrismaAccountRegistrationRepository
  implements AccountRegistrationRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async registerPendingUser(
    data: PendingRegistrationData,
    beforeCommit: (user: RegisteredUser) => Promise<void>,
  ): Promise<RegisteredUser> {
    return this.prisma.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<InsertedUserRow[]>`
          INSERT INTO auth."user" (name, email, password_hash)
          VALUES (${data.name}, ${data.email}, ${data.passwordHash})
          RETURNING id_user, name, email, status, email_verified
        `;

        await tx.$executeRaw`
          INSERT INTO auth.recovery_token (id_user, token_hash, type, expires_at)
          VALUES (
            ${row.id_user}::uuid,
            ${data.activationTokenHash},
            ${RecoveryTokenType.ACCOUNT_ACTIVATION},
            ${data.activationTokenExpiresAt}
          )
        `;

        const user: RegisteredUser = {
          id: row.id_user,
          name: row.name,
          email: row.email,
          status: row.status as UserStatus,
          emailVerified: row.email_verified,
        };

        await beforeCommit(user);

        return user;
      },
      { timeout: REGISTRATION_TRANSACTION_TIMEOUT_MS },
    );
  }
}
