import { Injectable } from '@nestjs/common';

import { PasswordHasher } from '../../domain/ports/password-hasher.port';
import { TokenService } from '../../domain/ports/token-service.port';

import { UserRepository } from '../../../users/domain/repositories/user.repository';
import { UserStatus } from '../../../users/domain/entities/user-status.enum';

import { InvalidCredentialsError } from '../../domain/errors/invalid-credentials.error';
import { AccountNotActiveError } from '../../domain/errors/account-not-active.error';
import { AccountLockedError } from '../../domain/errors/account-locked.error';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { SecureToken } from '../../domain/ports/secure-token.port';

import { RefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';

export interface LoginUserInput {
  email: string;
  password: string;
}

export interface LoginUserOutput {
  accessToken: string;
  tokenType: 'Bearer';

  refreshToken: string;
  refreshTokenExpiresAt: Date;

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
    private readonly secureToken: SecureToken,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly configService: ConfigService,
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
        sessionVersion: user.sessionVersion,
      });

    const refreshToken =
      this.secureToken.generate();

    const refreshTokenHash =
      this.secureToken.hash(
        refreshToken,
      );

    const refreshTokenDays =
      Number(
        this.configService.get<string>(
          'REFRESH_TOKEN_EXPIRES_DAYS',
        ) ?? '30',
      );

    const refreshTokenExpiresAt =
      new Date(
        Date.now() +
          refreshTokenDays *
            24 *
            60 *
            60 *
            1000,
      );

    await this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: refreshTokenHash,
      familyId: randomUUID(),
      sessionVersion: user.sessionVersion,
      expiresAt: refreshTokenExpiresAt,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      refreshToken,
      refreshTokenExpiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.roleName,
      },
    };
  }
  
}