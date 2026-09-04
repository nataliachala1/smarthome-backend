import { Injectable } from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

import { HomeMember } from '../../domain/entities/home-member.entity';
import {
  CreateInvitationData,
  HomeMemberRepository,
} from '../../domain/repositories/home-member.repository';

import { PrismaHomeMemberMapper } from './prisma-home-member.mapper';

@Injectable()
export class PrismaHomeMemberRepository
  implements HomeMemberRepository
{
  constructor(
    private readonly prismaRls: PrismaRlsService,
  ) {}

  async findAllByHome(
    userId: string,
    homeId: string,
  ): Promise<HomeMember[]> {
    return this.prismaRls.withUserContext(
      userId,
      async (tx) => {
        const members =
          await tx.home_member.findMany({
            where: {
              id_home: homeId,
            },
            orderBy: {
              created_at: 'asc',
            },
          });

        return members.map(
          PrismaHomeMemberMapper.toDomain,
        );
      },
    );
  }

  async findPendingByUser(
  userId: string,
): Promise<HomeMember[]> {
  return this.prismaRls.withUserContext(
    userId,
    async (tx) => {
      const members = await tx.home_member.findMany({
        where: {
          id_user: userId,
          status: 'PENDING',
        },
        orderBy: {
          invited_at: 'desc',
        },
      });

      return members.map(
        PrismaHomeMemberMapper.toDomain,
      );
    },
  );
}

async findByIdForUser(
  userId: string,
  memberId: string,
): Promise<HomeMember | null> {
  return this.prismaRls.withUserContext(
    userId,
    async (tx) => {
      const raw = await tx.home_member.findFirst({
        where: {
          id_home_member: memberId,
          id_user: userId,
        },
      });

      return raw
        ? PrismaHomeMemberMapper.toDomain(raw)
        : null;
    },
  );
}

async acceptInvitation(
  userId: string,
  memberId: string,
): Promise<HomeMember> {
  return this.prismaRls.withUserContext(
    userId,
    async (tx) => {
      const raw = await tx.home_member.update({
        where: {
          id_home_member: memberId,
        },
        data: {
          status: 'ACTIVE',
          accepted_at: new Date(),
          ended_at: null,
        },
      });

      return PrismaHomeMemberMapper.toDomain(raw);
    },
  );
}

async rejectInvitation(
  userId: string,
  memberId: string,
): Promise<HomeMember> {
  return this.prismaRls.withUserContext(
    userId,
    async (tx) => {
      const raw = await tx.home_member.update({
        where: {
          id_home_member: memberId,
        },
        data: {
          status: 'LEFT',
          accepted_at: null,
          ended_at: new Date(),
        },
      });

      return PrismaHomeMemberMapper.toDomain(raw);
    },
  );
}

async leaveHome(
  userId: string,
  homeId: string,
): Promise<HomeMember> {
  return this.prismaRls.withUserContext(
    userId,
    async (tx) => {
      const current = await tx.home_member.findFirst({
        where: {
          id_home: homeId,
          id_user: userId,
          status: 'ACTIVE',
          role: {
            in: ['MEMBER', 'GUEST'],
          },
        },
      });

      if (!current) {
        throw new Error('ACTIVE_MEMBERSHIP_NOT_FOUND');
      }

      const raw = await tx.home_member.update({
        where: {
          id_home_member: current.id_home_member,
        },
        data: {
          status: 'LEFT',
          ended_at: new Date(),
        },
      });

      return PrismaHomeMemberMapper.toDomain(raw);
    },
  );
}
async updateRole(
  userId: string,
  homeId: string,
  memberId: string,
  role: 'MEMBER' | 'GUEST',
): Promise<HomeMember> {
  return this.prismaRls.withUserContext(
    userId,
    async (tx) => {
      const raw = await tx.home_member.update({
        where: {
          id_home_member: memberId,
        },
        data: {
          role,
        },
      });

      return PrismaHomeMemberMapper.toDomain(raw);
    },
  );
}

async revoke(
  userId: string,
  homeId: string,
  memberId: string,
): Promise<HomeMember> {
  return this.prismaRls.withUserContext(
    userId,
    async (tx) => {
      const current = await tx.home_member.findFirst({
        where: {
          id_home_member: memberId,
          id_home: homeId,
          role: {
            in: ['MEMBER', 'GUEST'],
          },
          status: {
            in: ['PENDING', 'ACTIVE'],
          },
        },
      });

      if (!current) {
        throw new Error('MEMBERSHIP_NOT_REVOCABLE');
      }

      const raw = await tx.home_member.update({
        where: {
          id_home_member: memberId,
        },
        data: {
          status: 'REVOKED',
          ended_at: new Date(),
        },
      });

      return PrismaHomeMemberMapper.toDomain(raw);
    },
  );
}
  async createInvitation(
    data: CreateInvitationData,
  ): Promise<HomeMember> {
    return this.prismaRls.withUserContext(
      data.userId,
      async (tx) => {
        const raw =
          await tx.home_member.create({
            data: {
              id_home: data.homeId,
              id_user: data.invitedUserId,
              role: data.role,
              status: 'PENDING',
              invited_by: data.userId,
              accepted_at: null,
              ended_at: null,
            },
          });

        return PrismaHomeMemberMapper.toDomain(
          raw,
        );
      },
    );
  }
}