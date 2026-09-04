import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { HomeMemberRepository } from '../../domain/repositories/home-member.repository';

export interface UpdateHomeMemberRoleInput {
  userId: string;
  homeId: string;
  memberId: string;
  role: 'MEMBER' | 'GUEST';
}

@Injectable()
export class UpdateHomeMemberRoleUseCase {
  constructor(
    private readonly homeMemberRepository:
      HomeMemberRepository,
  ) {}

  async execute(
    input: UpdateHomeMemberRoleInput,
  ) {
    const members =
      await this.homeMemberRepository.findAllByHome(
        input.userId,
        input.homeId,
      );

    const current = members.find(
      (member) => member.id === input.memberId,
    );

    if (!current) {
      throw new NotFoundException(
        'Membresía no encontrada',
      );
    }

    if (
      !['MEMBER', 'GUEST'].includes(current.role) ||
      !['PENDING', 'ACTIVE'].includes(current.status)
    ) {
      throw new ConflictException(
        'La membresía no permite cambiar el rol',
      );
    }

    const member =
      await this.homeMemberRepository.updateRole(
        input.userId,
        input.homeId,
        input.memberId,
        input.role,
      );

    return {
      id: member.id,
      homeId: member.homeId,
      userId: member.userId,
      role: member.role,
      status: member.status,
      acceptedAt: member.acceptedAt,
      endedAt: member.endedAt,
      updatedAt: member.updatedAt,
    };
  }
}