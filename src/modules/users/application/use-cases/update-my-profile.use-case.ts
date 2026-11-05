import { Injectable, NotFoundException } from '@nestjs/common';

import { UpdateMyProfileDto } from '../dto/update-my-profile.dto';
import { UserRepository } from '../../domain/repositories/user.repository';

@Injectable()
export class UpdateMyProfileUseCase {
  constructor(private readonly userRepository: UserRepository) {}

  async execute(userId: string, input: UpdateMyProfileDto) {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const updated = await this.userRepository.updateProfile(userId, input);

    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.roleName,
      status: updated.status,
      emailVerified: updated.emailVerified,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}
