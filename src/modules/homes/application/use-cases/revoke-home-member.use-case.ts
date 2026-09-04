import {
  ConflictException,
  Injectable,
} from '@nestjs/common';

import { HomeMemberRepository } from '../../domain/repositories/home-member.repository';

@Injectable()
export class RevokeHomeMemberUseCase {
  constructor(
    private readonly homeMemberRepository:
      HomeMemberRepository,
  ) {}

  async execute(
    userId: string,
    homeId: string,
    memberId: string,
  ) {
    try {
      const member =
        await this.homeMemberRepository.revoke(
          userId,
          homeId,
          memberId,
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
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message === 'MEMBERSHIP_NOT_REVOCABLE'
      ) {
        throw new ConflictException(
          'La membresía no puede ser revocada',
        );
      }

      throw error;
    }
  }
}