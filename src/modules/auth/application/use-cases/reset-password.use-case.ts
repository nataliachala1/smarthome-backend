import { Injectable } from '@nestjs/common';

import { PasswordHasher } from '../../domain/ports/password-hasher.port';
import { SecureToken } from '../../domain/ports/secure-token.port';
import { RecoveryTokenType } from '../../domain/ports/recovery-token-type.enum';
import { RecoveryTokenRepository } from '../../domain/repositories/recovery-token.repository';

import { UserRepository } from '../../../users/domain/repositories/user.repository';

import { PasswordsDoNotMatchError } from '../../domain/errors/passwords-do-not-match.error';
import { InvalidPasswordResetTokenError } from '../../domain/errors/invalid-password-reset-token.error';

export interface ResetPasswordInput {
  token: string;
  password: string;
  passwordConfirmation: string;
}

export interface ResetPasswordOutput {
  reset: boolean;
}

@Injectable()
export class ResetPasswordUseCase {
  constructor(
    private readonly secureToken: SecureToken,
    private readonly passwordHasher: PasswordHasher,
    private readonly recoveryTokenRepository: RecoveryTokenRepository,
    private readonly userRepository: UserRepository,
  ) {}

  async execute(
    input: ResetPasswordInput,
  ): Promise<ResetPasswordOutput> {
    if (input.password !== input.passwordConfirmation) {
      throw new PasswordsDoNotMatchError();
    }

    const tokenHash = this.secureToken.hash(input.token);

    const recoveryToken =
      await this.recoveryTokenRepository.findValidByHashAndType(
        tokenHash,
        RecoveryTokenType.PASSWORD_RESET,
      );

    if (!recoveryToken) {
      throw new InvalidPasswordResetTokenError();
    }

    const passwordHash = await this.passwordHasher.hash(input.password);

    await this.userRepository.updatePassword(
      recoveryToken.userId,
      passwordHash,
    );

    await this.recoveryTokenRepository.markAsUsed(recoveryToken.id);

    return {
      reset: true,
    };
  }
}