import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UserRepository } from '../../domain/repositories/user.repository';
import { UserStatus } from '../../domain/entities/user-status.enum';

@Injectable()
export class DeactivateMyAccountUseCase {
  constructor(
    private readonly userRepository:
      UserRepository,
  ) {}

  async execute(userId: string) {
    const user =
      await this.userRepository.findById(
        userId,
      );

    if (!user) {
      throw new NotFoundException(
        'Usuario no encontrado',
      );
    }

    if (
      user.status ===
      UserStatus.DEACTIVATED
    ) {
      throw new ConflictException(
        'La cuenta ya está desactivada',
      );
    }

    if (
      user.status !==
      UserStatus.ACTIVE
    ) {
      throw new ConflictException(
        'Solo una cuenta activa puede ser desactivada',
      );
    }

    const result =
      await this.userRepository.deactivate(
        userId,
      );

    return {
      message:
        'Tu cuenta ha sido desactivada exitosamente',
      status:
        UserStatus.DEACTIVATED,
      deactivatedAt:
        result.deactivatedAt,
    };
  }
}