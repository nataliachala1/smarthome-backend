import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { HomeMemberRepository } from '../../domain/repositories/home-member.repository';
import { UserRepository } from '../../../users/domain/repositories/user.repository';

export interface CreateHomeInvitationInput {
  userId: string;
  homeId: string;
  email: string;
  role: 'MEMBER' | 'GUEST';
}

@Injectable()
export class CreateHomeInvitationUseCase {
  constructor(
    private readonly homeMemberRepository:
      HomeMemberRepository,

    private readonly userRepository:
      UserRepository,
  ) {}

  async execute(
    input: CreateHomeInvitationInput,
  ) {
    const invitedUser =
      await this.userRepository.findByEmail(
        input.email.trim().toLowerCase(),
      );

    if (!invitedUser) {
      throw new NotFoundException(
        'No existe un usuario registrado con ese correo',
      );
    }

    if (invitedUser.status !== 'ACTIVE') {
      throw new BadRequestException(
        'El usuario invitado no se encuentra activo',
      );
    }

    if (invitedUser.id === input.userId) {
      throw new BadRequestException(
        'No puedes invitarte a ti mismo al hogar',
      );
    }

    try {
      const member =
        await this.homeMemberRepository.createInvitation({
          userId: input.userId,
          homeId: input.homeId,
          invitedUserId: invitedUser.id,
          role: input.role,
        });

      return {
        id: member.id,
        homeId: member.homeId,
        userId: member.userId,
        role: member.role,
        status: member.status,
        invitedBy: member.invitedBy,
        invitedAt: member.invitedAt,
      };
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'El usuario ya tiene una invitación o membresía activa en este hogar',
        );
      }

      throw error;
    }
  }
}