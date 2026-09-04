import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { HomeMemberRepository } from '../../domain/repositories/home-member.repository';

@Injectable()
export class RejectInvitationUseCase {
  constructor(
    private readonly homeMemberRepository:
      HomeMemberRepository,
  ) {}

  async execute(
    userId: string,
    memberId: string,
  ) {
    const current =
      await this.homeMemberRepository.findByIdForUser(
        userId,
        memberId,
      );

    if (!current) {
      throw new NotFoundException(
        'Invitación no encontrada',
      );
    }

    if (current.status !== 'PENDING') {
      throw new ConflictException(
        'La invitación ya no está pendiente',
      );
    }

    const member =
      await this.homeMemberRepository.rejectInvitation(
        userId,
        memberId,
      );

    return {
      id: member.id,
      homeId: member.homeId,
      role: member.role,
      status: member.status,
      endedAt: member.endedAt,
    };
  }
}