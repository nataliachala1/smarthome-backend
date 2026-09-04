import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PasswordHasher } from '../../domain/ports/password-hasher.port';
import { SecureToken } from '../../domain/ports/secure-token.port';
import { EmailSender } from '../../domain/ports/email-sender.port';

import { RecoveryTokenType } from '../../domain/ports/recovery-token-type.enum';

import { RecoveryTokenRepository } from '../../domain/repositories/recovery-token.repository';

import { EmailAlreadyExistsError } from '../../domain/errors/email-already-exists.error';

import { UserRepository } from '../../../users/domain/repositories/user.repository';
import { UserStatus } from '../../../users/domain/entities/user-status.enum';

export interface RegisterUserInput {
  name: string;
  email: string;
  password: string;
}

export interface RegisterUserOutput {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  emailVerified: boolean;
}

@Injectable()
export class RegisterUserUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly secureToken: SecureToken,
    private readonly recoveryTokenRepository: RecoveryTokenRepository,
    private readonly emailSender: EmailSender,
    private readonly configService: ConfigService,
  ) {}

  async execute(
    input: RegisterUserInput,
  ): Promise<RegisterUserOutput> {
    const normalizedEmail = input.email
      .trim()
      .toLowerCase();

    const existingUser =
      await this.userRepository.findByEmail(normalizedEmail);

    if (existingUser) {
      throw new EmailAlreadyExistsError();
    }

    const passwordHash =
      await this.passwordHasher.hash(input.password);

    const user = await this.userRepository.create({
      name: input.name.trim(),
      email: normalizedEmail,
      passwordHash,
    });

    const activationToken =
      this.secureToken.generate();

    const activationTokenHash =
      this.secureToken.hash(activationToken);

    const expiresAt =
      new Date(Date.now() + 30 * 60 * 1000);

    await this.recoveryTokenRepository.create({
      userId: user.id,
      tokenHash: activationTokenHash,
      type: RecoveryTokenType.ACCOUNT_ACTIVATION,
      expiresAt,
    });

    const frontendUrl =
      this.configService.getOrThrow<string>('FRONTEND_URL');

    const activationUrl =
      `${frontendUrl}/activate-account?token=${encodeURIComponent(
        activationToken,
      )}`;

    await this.emailSender.sendAccountActivationEmail({
      to: user.email,
      name: user.name,
      activationUrl,
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      emailVerified: user.emailVerified,
    };
  }
}