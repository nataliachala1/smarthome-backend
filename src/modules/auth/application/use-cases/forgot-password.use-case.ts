import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { UserRepository } from '../../../users/domain/repositories/user.repository';

import { RecoveryTokenRepository } from '../../domain/repositories/recovery-token.repository';
import { RecoveryTokenType } from '../../domain/ports/recovery-token-type.enum';
import { SecureToken } from '../../domain/ports/secure-token.port';
import { EmailSender } from '../../domain/ports/email-sender.port';
import { UserStatus } from '../../../users/domain/entities/user-status.enum';

export interface ForgotPasswordInput {
  email: string;
}

export interface ForgotPasswordOutput {
  sent: boolean;
}

@Injectable()
export class ForgotPasswordUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly recoveryTokenRepository: RecoveryTokenRepository,
    private readonly secureToken: SecureToken,
    private readonly emailSender: EmailSender,
    private readonly configService: ConfigService,
  ) {}

  async execute(
    input: ForgotPasswordInput,
  ): Promise<ForgotPasswordOutput> {
    const email = input.email.trim().toLowerCase();

    const user = await this.userRepository.findByEmail(email);

    if (
      !user ||
      user.status === UserStatus.PENDING ||
      user.status === UserStatus.DEACTIVATED
    ) {
      return {
        sent: true,
      };
    }

    await this.recoveryTokenRepository.invalidateUnusedByUserAndType(
      user.id,
      RecoveryTokenType.PASSWORD_RESET,
    );

    const token = this.secureToken.generate();
    const tokenHash = this.secureToken.hash(token);

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await this.recoveryTokenRepository.create({
      userId: user.id,
      tokenHash,
      type: RecoveryTokenType.PASSWORD_RESET,
      expiresAt,
    });

    const frontendUrl =
      this.configService.getOrThrow<string>('FRONTEND_URL');

    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(
      token,
    )}`;

    await this.emailSender.sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl,
    });

    return {
      sent: true,
    };
  }
}