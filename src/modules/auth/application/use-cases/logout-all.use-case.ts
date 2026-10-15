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
     * Primero invalidamos todos los access tokens.
     */
    const sessionVersion =
      await this.userRepository.incrementSessionVersion(userId);
    this.revocations.revokeOlderSessions(userId, sessionVersion);

    /*
     * Después revocamos todos los refresh tokens.
     *
     * Incluso si esta segunda operación fallara,
     * los refresh anteriores quedarían inválidos
     * porque su session_version ya no coincidiría.
     */
    await this.refreshTokenRepository.revokeAllByUser(userId);
  }
}
