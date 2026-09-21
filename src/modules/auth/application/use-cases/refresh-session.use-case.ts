import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SecureToken } from '../../domain/ports/secure-token.port';
import { TokenService } from '../../domain/ports/token-service.port';

import { RefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';

import { UserRepository } from '../../../users/domain/repositories/user.repository';
import { UserStatus } from '../../../users/domain/entities/user-status.enum';

import { InvalidRefreshTokenError } from '../../domain/errors/invalid-refresh-token.error';

export interface RefreshSessionOutput {
  accessToken: string;
  tokenType: 'Bearer';

  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

@Injectable()
export class RefreshSessionUseCase {
  constructor(
    private readonly refreshTokenRepository:
      RefreshTokenRepository,

    private readonly userRepository:
      UserRepository,

    private readonly secureToken:
      SecureToken,

    private readonly tokenService:
      TokenService,

    private readonly configService:
      ConfigService,
  ) {}

  async execute(
    rawRefreshToken: string,
  ): Promise<RefreshSessionOutput> {
    if (!rawRefreshToken) {
      throw new InvalidRefreshTokenError();
    }

    const tokenHash =
      this.secureToken.hash(
        rawRefreshToken,
      );

    const storedToken =
      await this.refreshTokenRepository.findByHash(
        tokenHash,
      );

    if (!storedToken) {
      throw new InvalidRefreshTokenError();
    }

    /*
     * Si intentan reutilizar un refresh token
     * ya revocado, invalidamos toda su familia.
     */
    if (storedToken.isRevoked) {
      await this.refreshTokenRepository.revokeFamily(
        storedToken.familyId,
      );

      throw new InvalidRefreshTokenError(
        'Se detectó reutilización de un refresh token revocado',
      );
    }

    if (storedToken.isExpired) {
      await this.refreshTokenRepository.revoke(
        storedToken.id,
      );

      throw new InvalidRefreshTokenError(
        'El refresh token ha expirado',
      );
    }

    const user =
      await this.userRepository.findById(
        storedToken.userId,
      );

    if (!user) {
      throw new InvalidRefreshTokenError();
    }

    if (
      user.status !==
      UserStatus.ACTIVE
    ) {
      await this.refreshTokenRepository.revokeFamily(
        storedToken.familyId,
      );

      throw new InvalidRefreshTokenError(
        'La cuenta asociada al refresh token no está activa',
      );
    }

    /*
     * Si session_version cambió, el refresh
     * pertenece a una sesión revocada.
     */
    if (
      storedToken.sessionVersion !==
      user.sessionVersion
    ) {
      await this.refreshTokenRepository.revokeFamily(
        storedToken.familyId,
      );

      throw new InvalidRefreshTokenError(
        'La sesión fue revocada',
      );
    }

    const newRefreshToken =
      this.secureToken.generate();

    const newRefreshTokenHash =
      this.secureToken.hash(
        newRefreshToken,
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

    /*
     * El nuevo refresh conserva el mismo
     * familyId.
     */
    await this.refreshTokenRepository.create({
      userId:
        user.id,

      tokenHash:
        newRefreshTokenHash,

      familyId:
        storedToken.familyId,

      sessionVersion:
        user.sessionVersion,

      expiresAt:
        refreshTokenExpiresAt,
    });

    /*
     * Marcamos el anterior como reemplazado.
     */
    await this.refreshTokenRepository.revoke(
      storedToken.id,
      newRefreshTokenHash,
    );

    await this.refreshTokenRepository.markAsUsed(
      storedToken.id,
    );

    const accessToken =
      await this.tokenService.generateAccessToken({
        userId:
          user.id,

        globalRole:
          user.roleName,

        sessionVersion:
          user.sessionVersion,
      });

    return {
      accessToken,

      tokenType:
        'Bearer',

      refreshToken:
        newRefreshToken,

      refreshTokenExpiresAt,
    };
  }
}