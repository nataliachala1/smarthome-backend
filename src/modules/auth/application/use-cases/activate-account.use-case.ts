import { Injectable } from '@nestjs/common';

import { SecureToken } from '../../domain/ports/secure-token.port';
import { RecoveryTokenRepository } from '../../domain/repositories/recovery-token.repository';
import { AccountActivationRepository } from '../../domain/repositories/account-activation.repository';

import { RecoveryTokenType } from '../../domain/ports/recovery-token-type.enum';

import { InvalidActivationTokenError } from '../../domain/errors/invalid-activation-token.error';

export interface ActivateAccountInput {
  token: string;
}

export interface ActivateAccountOutput {
  activated: boolean;
}

@Injectable()
export class ActivateAccountUseCase {
  constructor(
    private readonly secureToken: SecureToken,
    private readonly recoveryTokenRepository: RecoveryTokenRepository,
    private readonly accountActivationRepository: AccountActivationRepository,
  ) {}

  async execute(
    input: ActivateAccountInput,
  ): Promise<ActivateAccountOutput> {
    const tokenHash =
      this.secureToken.hash(input.token);

    const recoveryToken =
      await this.recoveryTokenRepository.findValidByHashAndType(
        tokenHash,
        RecoveryTokenType.ACCOUNT_ACTIVATION,
      );

    if (!recoveryToken) {
      throw new InvalidActivationTokenError();
    }

    await this.accountActivationRepository.activateAccount(
      recoveryToken.userId,
      recoveryToken.id,
    );

    return {
      activated: true,
    };
  }
}