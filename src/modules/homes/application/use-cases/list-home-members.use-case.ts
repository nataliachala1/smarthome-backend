import { Injectable } from '@nestjs/common';

import { HomeMemberRepository } from '../../domain/repositories/home-member.repository';

export interface ListHomeMembersInput {
  userId: string;
  homeId: string;
}

@Injectable()
export class ListHomeMembersUseCase {
  constructor(
    private readonly homeMemberRepository:
      HomeMemberRepository,
  ) {}

  async execute(input: ListHomeMembersInput) {
    const members =
      await this.homeMemberRepository.findAllByHome(
        input.userId,
        input.homeId,
      );

    return members.map((member) => ({
      id: member.id,
      homeId: member.homeId,
      userId: member.userId,
      role: member.role,
      status: member.status,
      invitedBy: member.invitedBy,
      invitedAt: member.invitedAt,
      acceptedAt: member.acceptedAt,
      endedAt: member.endedAt,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    }));
  }
}