import { Injectable } from '@nestjs/common';

import { SecureToken } from '../../domain/ports/secure-token.port';

import { RefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';

@Injectable()
export class LogoutUseCase {
  constructor(
    private readonly secureToken:
      SecureToken,

    private readonly refreshTokenRepository:
      RefreshTokenRepository,
  ) {}

  async execute(
    rawRefreshToken?: string,
  ): Promise<void> {
    /*
     * Logout será idempotente.
     *
     * Si no existe cookie, simplemente termina.
     */
    if (!rawRefreshToken) {
      return;
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
      return;
    }

    if (!storedToken.isRevoked) {
      await this.refreshTokenRepository.revoke(
        storedToken.id,
      );
    }
  }
}