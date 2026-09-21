import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { RefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';

import { UserRepository } from '../../../users/domain/repositories/user.repository';

@Injectable()
export class LogoutAllUseCase {
  constructor(
    private readonly userRepository:
      UserRepository,

    private readonly refreshTokenRepository:
      RefreshTokenRepository,
  ) {}

  async execute(
    userId: string,
  ): Promise<void> {
    const user =
      await this.userRepository.findById(
        userId,
      );

    if (!user) {
      throw new NotFoundException(
        'Usuario no encontrado',
      );
    }

    /*
     * Primero invalidamos todos los access tokens.
     */
    await this.userRepository.incrementSessionVersion(
      userId,
    );

    /*
     * Después revocamos todos los refresh tokens.
     *
     * Incluso si esta segunda operación fallara,
     * los refresh anteriores quedarían inválidos
     * porque su session_version ya no coincidiría.
     */
    await this.refreshTokenRepository.revokeAllByUser(
      userId,
    );
  }
}