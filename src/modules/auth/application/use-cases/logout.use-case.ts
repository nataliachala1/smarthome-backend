import { Injectable } from '@nestjs/common';

import { SecureToken } from '../../domain/ports/secure-token.port';

import { RefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';
import { SessionRevocationService } from '../../../../security/session-revocation.module';

@Injectable()
export class LogoutUseCase {
  constructor(
    private readonly secureToken: SecureToken,

    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly revocations: SessionRevocationService,
  ) {}

  async execute(rawRefreshToken?: string): Promise<void> {
    /*
     * Logout será idempotente.
     *
     * Si no existe cookie, simplemente termina.
     */
    if (!rawRefreshToken) {
      return;
    }

    const tokenHash = this.secureToken.hash(rawRefreshToken);

    const storedToken = await this.refreshTokenRepository.findByHash(tokenHash);

    if (!storedToken) {
      return;
    }

    // Also accept an older rotated cookie: logout must close its whole family.
    await this.refreshTokenRepository.revokeFamily(storedToken.familyId);
    this.revocations.revokeFamily(storedToken.userId, storedToken.familyId);
  }
}
