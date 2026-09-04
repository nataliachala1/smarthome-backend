import {
  ConflictException,
  Injectable,
} from '@nestjs/common';

import { HomeMemberRepository } from '../../domain/repositories/home-member.repository';

@Injectable()
export class LeaveHomeUseCase {
  constructor(
    private readonly homeMemberRepository:
      HomeMemberRepository,
  ) {}

  async execute(
    userId: string,
    homeId: string,
  ) {
    try {
      const member =
        await this.homeMemberRepository.leaveHome(
          userId,
          homeId,
        );

      return {
        id: member.id,
        homeId: member.homeId,
        role: member.role,
        status: member.status,
        acceptedAt: member.acceptedAt,
        endedAt: member.endedAt,
      };
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message === 'ACTIVE_MEMBERSHIP_NOT_FOUND'
      ) {
        throw new ConflictException(
          'No tienes una membresía activa que puedas abandonar en este hogar',
        );
      }

      throw error;
    }
  }
}