import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { UserRepository } from '../../../users/domain/repositories/user.repository';
import { UserStatus } from '../../../users/domain/entities/user-status.enum';

import { RecoveryTokenRepository } from '../../domain/repositories/recovery-token.repository';
import { RecoveryTokenType } from '../../domain/ports/recovery-token-type.enum';
import { SecureToken } from '../../domain/ports/secure-token.port';
import { EmailSender } from '../../domain/ports/email-sender.port';

export interface ResendActivationInput {
  email: string;
}

export interface ResendActivationOutput {
  sent: boolean;
}

@Injectable()
export class ResendActivationUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly recoveryTokenRepository: RecoveryTokenRepository,
    private readonly secureToken: SecureToken,
    private readonly emailSender: EmailSender,
    private readonly configService: ConfigService,
  ) {}

  async execute(
    input: ResendActivationInput,
  ): Promise<ResendActivationOutput> {
    const email = input.email.trim().toLowerCase();

    const user = await this.userRepository.findByEmail(email);

    // Respuesta deliberadamente genérica.
    if (!user || user.status !== UserStatus.PENDING) {
      return { sent: true };
    }

    await this.recoveryTokenRepository.invalidateUnusedByUserAndType(
      user.id,
      RecoveryTokenType.ACCOUNT_ACTIVATION,
    );

    const token = this.secureToken.generate();
    const tokenHash = this.secureToken.hash(token);

    const expiresAt =
      new Date(Date.now() + 30 * 60 * 1000);

    await this.recoveryTokenRepository.create({
      userId: user.id,
      tokenHash,
      type: RecoveryTokenType.ACCOUNT_ACTIVATION,
      expiresAt,
    });

    const frontendUrl =
      this.configService.getOrThrow<string>('FRONTEND_URL');

    const activationUrl =
      `${frontendUrl}/activate-account?token=${encodeURIComponent(token)}`;

    await this.emailSender.sendAccountActivationEmail({
      to: user.email,
      name: user.name,
      activationUrl,
    });

    return {
      sent: true,
    };
  }
}