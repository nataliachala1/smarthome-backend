import { Injectable } from '@nestjs/common';

import { HomeMemberRepository } from '../../domain/repositories/home-member.repository';

@Injectable()
export class ListMyInvitationsUseCase {
  constructor(
    private readonly homeMemberRepository:
      HomeMemberRepository,
  ) {}

  async execute(userId: string) {
    const invitations =
      await this.homeMemberRepository.findPendingByUser(
        userId,
      );

    return invitations.map((member) => ({
      id: member.id,
      homeId: member.homeId,
      role: member.role,
      status: member.status,
      invitedBy: member.invitedBy,
      invitedAt: member.invitedAt,
    }));
  }
}