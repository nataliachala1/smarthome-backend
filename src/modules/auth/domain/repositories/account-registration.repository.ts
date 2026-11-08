import { UserStatus } from '../../../users/domain/entities/user-status.enum';

export interface PendingRegistrationData {
  name: string;
  email: string;
  passwordHash: string;
  activationTokenHash: string;
  activationTokenExpiresAt: Date;
}

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  emailVerified: boolean;
}

/**
 * Creates a pending user and its activation token atomically.
 *
 * `beforeCommit` runs inside the same database transaction, after both rows
 * exist. If it throws (for example, the activation email cannot be sent),
 * the transaction is rolled back and no partial registration remains.
 */
export abstract class AccountRegistrationRepository {
  abstract registerPendingUser(
    data: PendingRegistrationData,
    beforeCommit: (user: RegisteredUser) => Promise<void>,
  ): Promise<RegisteredUser>;
}
