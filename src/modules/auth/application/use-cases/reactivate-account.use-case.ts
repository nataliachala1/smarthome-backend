import { Injectable } from '@nestjs/common';

import { SecureToken } from '../../domain/ports/secure-token.port';

import { RecoveryTokenRepository } from '../../domain/repositories/recovery-token.repository';

import { RecoveryTokenType } from '../../domain/ports/recovery-token-type.enum';

import { UserRepository } from '../../../users/domain/repositories/user.repository';

import { UserStatus } from '../../../users/domain/entities/user-status.enum';

import { InvalidActivationTokenError } from '../../domain/errors/invalid-activation-token.error';

export interface ReactivateAccountInput {
  token: string;
}

export interface ReactivateAccountOutput {
  reactivated: boolean;
}

@Injectable()
export class ReactivateAccountUseCase {
  constructor(
    private readonly secureToken:
      SecureToken,

    private readonly recoveryTokenRepository:
      RecoveryTokenRepository,

    private readonly userRepository:
      UserRepository,
  ) {}

  async execute(
    input: ReactivateAccountInput,
  ): Promise<ReactivateAccountOutput> {
    const tokenHash =
      this.secureToken.hash(
        input.token,
      );

    const recoveryToken =
      await this.recoveryTokenRepository
        .findValidByHashAndType(
          tokenHash,
          RecoveryTokenType.ACCOUNT_REACTIVATION,
        );

    if (!recoveryToken) {
      throw new InvalidActivationTokenError();
    }

    const user =
      await this.userRepository.findById(
        recoveryToken.userId,
      );

    if (
      !user ||
      user.status !==
        UserStatus.DEACTIVATED
    ) {
      throw new InvalidActivationTokenError();
    }

    await this.userRepository.reactivate(
      user.id,
    );

    await this.recoveryTokenRepository.markAsUsed(
      recoveryToken.id,
    );

    return {
      reactivated:
        true,
    };
  }
}