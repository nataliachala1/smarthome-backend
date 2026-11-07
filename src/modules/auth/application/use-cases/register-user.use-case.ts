import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PasswordHasher } from '../../domain/ports/password-hasher.port';
import { SecureToken } from '../../domain/ports/secure-token.port';
import { EmailSender } from '../../domain/ports/email-sender.port';

import { AccountRegistrationRepository } from '../../domain/repositories/account-registration.repository';

import { EmailAlreadyExistsError } from '../../domain/errors/email-already-exists.error';

import { UserRepository } from '../../../users/domain/repositories/user.repository';
import { UserStatus } from '../../../users/domain/entities/user-status.enum';

import { PasswordsDoNotMatchError } from '../../domain/errors/passwords-do-not-match.error';

export interface RegisterUserInput {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
}

export interface RegisterUserOutput {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  emailVerified: boolean;
}

/** Activation links stay valid for 30 minutes. */
const ACTIVATION_TOKEN_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class RegisterUserUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly secureToken: SecureToken,
    private readonly accountRegistrationRepository: AccountRegistrationRepository,
    private readonly emailSender: EmailSender,
    private readonly configService: ConfigService,
  ) {}

  async execute(input: RegisterUserInput): Promise<RegisterUserOutput> {
    if (input.password !== input.passwordConfirmation) {
      throw new PasswordsDoNotMatchError();
    }

    const normalizedEmail = input.email.trim().toLowerCase();

    const existingUser = await this.userRepository.findByEmail(normalizedEmail);

    if (existingUser) {
      throw new EmailAlreadyExistsError();
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    const activationToken = this.secureToken.generate();
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const activationUrl = `${frontendUrl}/activate-account?token=${encodeURIComponent(
      activationToken,
    )}`;

    // The email is sent before the transaction commits: if delivery fails,
    // neither the user nor the token is persisted and the email stays free.
    return this.accountRegistrationRepository.registerPendingUser(
      {
        name: input.name.trim(),
        email: normalizedEmail,
        passwordHash,
        activationTokenHash: this.secureToken.hash(activationToken),
        activationTokenExpiresAt: new Date(Date.now() + ACTIVATION_TOKEN_TTL_MS),
      },
      (user) =>
        this.emailSender.sendAccountActivationEmail({
          to: user.email,
          name: user.name,
          activationUrl,
        }),
    );
  }
}
