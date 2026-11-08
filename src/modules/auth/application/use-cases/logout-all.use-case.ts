import { Injectable, NotFoundException } from '@nestjs/common';

import { RefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';

import { UserRepository } from '../../../users/domain/repositories/user.repository';
import { SessionRevocationService } from '../../../../security/session-revocation.module';

@Injectable()
export class LogoutAllUseCase {
  constructor(
    private readonly userRepository: UserRepository,

    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly revocations: SessionRevocationService,
  ) {}

  async execute(userId: string): Promise<void> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    /*
     * First, every access token is invalidated.
     */
    const sessionVersion =
      await this.userRepository.incrementSessionVersion(userId);
    this.revocations.revokeOlderSessions(userId, sessionVersion);

    /*
     * Then every refresh token is revoked.
     *
     * Even if this second operation failed,
     * the previous refresh tokens would stay invalid
     * because their session_version would no longer match.
     */
    await this.refreshTokenRepository.revokeAllByUser(userId);
  }
}
