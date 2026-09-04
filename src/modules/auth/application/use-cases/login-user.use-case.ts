import { Injectable } from '@nestjs/common';

import { PasswordHasher } from '../../domain/ports/password-hasher.port';
import { TokenService } from '../../domain/ports/token-service.port';

import { UserRepository } from '../../../users/domain/repositories/user.repository';
import { UserStatus } from '../../../users/domain/entities/user-status.enum';

import { InvalidCredentialsError } from '../../domain/errors/invalid-credentials.error';
import { AccountNotActiveError } from '../../domain/errors/account-not-active.error';
import { AccountLockedError } from '../../domain/errors/account-locked.error';

export interface LoginUserInput {
  email: string;
  password: string;
}

export interface LoginUserOutput {
  accessToken: string;
  tokenType: 'Bearer';
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

@Injectable()
export class LoginUserUseCase {
  private readonly maxFailedAttempts = 5;
  private readonly lockDurationMs = 15 * 60 * 1000;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenService: TokenService,
  ) {}

  async execute(
    input: LoginUserInput,
  ): Promise<LoginUserOutput> {
    const normalizedEmail = input.email
      .trim()
      .toLowerCase();

    const user =
      await this.userRepository.findByEmail(normalizedEmail);

    if (!user) {
      throw new InvalidCredentialsError();
    }

    if (user.status === UserStatus.PENDING) {
      throw new AccountNotActiveError();
    }

    if (user.status === UserStatus.DEACTIVATED) {
      throw new AccountNotActiveError();
    }

  let failedLoginAttempts = user.failedLoginAttempts;

    if (
      user.status === UserStatus.LOCKED &&
      user.lockedUntil
    ) {
      if (user.lockedUntil > new Date()) {
        throw new AccountLockedError();
      }

      await this.userRepository.resetExpiredLock(user.id);

      failedLoginAttempts = 0;
    }

    const passwordMatches =
      await this.passwordHasher.verify(
        user.passwordHash,
        input.password,
      );

    if (!passwordMatches) {
      const failedAttempts =
        failedLoginAttempts + 1;

      if (failedAttempts >= this.maxFailedAttempts) {
        const lockedUntil =
          new Date(Date.now() + this.lockDurationMs);

        await this.userRepository.registerFailedLogin(
          user.id,
          failedAttempts,
          lockedUntil,
          UserStatus.LOCKED,
        );

        throw new AccountLockedError();
      }

      await this.userRepository.registerFailedLogin(
        user.id,
        failedAttempts,
        null,
        UserStatus.ACTIVE,
      );

      throw new InvalidCredentialsError();
    }

    await this.userRepository.registerSuccessfulLogin(
      user.id,
    );

    const accessToken =
      await this.tokenService.generateAccessToken({
        userId: user.id,
        globalRole: user.roleName,
      });

    return {
      accessToken,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.roleName,
      },
    };
  }
}