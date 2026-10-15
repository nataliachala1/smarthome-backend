import { Injectable, NotFoundException } from '@nestjs/common';

import { UserRepository } from '../../domain/repositories/user.repository';

@Injectable()
export class GetMyProfileUseCase {
  constructor(private readonly userRepository: UserRepository) {}

  async execute(userId: string) {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.roleName,
      status: user.status,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
