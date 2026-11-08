import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../infrastructure/database/prisma/prisma.service';

import {
  UpdateUserProfileData,
  UserRepository,
} from '../../domain/repositories/user.repository';

import { User } from '../../domain/entities/user.entity';
import { UserStatus } from '../../domain/entities/user-status.enum';

import { PrismaUserMapper } from './prisma-user.mapper';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    const normalizedEmail = email
      .trim()
      .toLowerCase();

    const raw = await this.prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
      },
      include: {
        role: true,
      },
    });

    return raw
      ? PrismaUserMapper.toDomain(raw)
      : null;
  }

  async findById(id: string): Promise<User | null> {
    const raw = await this.prisma.user.findUnique({
      where: {
        id_user: id,
      },
      include: {
        role: true,
      },
    });

    return raw
      ? PrismaUserMapper.toDomain(raw)
      : null;
  }

  async activate(id: string): Promise<void> {
    await this.prisma.user.update({
      where: {
        id_user: id,
      },
      data: {
        status: UserStatus.ACTIVE,
        email_verified: true,
        failed_login_attempts: 0,
        locked_until: null,
      },
    });
  }

  async registerFailedLogin(
    id: string,
    failedAttempts: number,
    lockedUntil: Date | null,
    status: UserStatus,
  ): Promise<void> {
    await this.prisma.user.update({
      where: {
        id_user: id,
      },
      data: {
        failed_login_attempts: failedAttempts,
        locked_until: lockedUntil,
        status,
      },
    });
  }

  async resetExpiredLock(id: string): Promise<void> {
  await this.prisma.user.update({
    where: {
      id_user: id,
    },
    data: {
      status: UserStatus.ACTIVE,
      failed_login_attempts: 0,
      locked_until: null,
    },
  });
}

  async registerSuccessfulLogin(
    id: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: {
        id_user: id,
      },
      data: {
        failed_login_attempts: 0,
        locked_until: null,
        status: UserStatus.ACTIVE,
        last_login_at: new Date(),
      },
    });
  }
  async updatePassword(
    id: string,
    passwordHash: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: {
        id_user: id,
      },
      data: {
        password_hash: passwordHash,
        failed_login_attempts: 0,
        locked_until: null,
        status: UserStatus.ACTIVE,
        updated_at: new Date(),
      },
    });
  }

  async reactivate(
  id: string,
  ): Promise<void> {
    await this.prisma.user.update({
      where: {
        id_user: id,
      },

      data: {
        status:
          UserStatus.ACTIVE,

        deactivated_at:
          null,

        failed_login_attempts:
          0,

        locked_until:
          null,

        updated_at:
          new Date(),
      },
    });
  }

  async updateProfile(
  id: string,
  data: UpdateUserProfileData,
  ): Promise<User> {
    const raw = await this.prisma.user.update({
      where: {
        id_user: id,
      },
      data: {
        ...(data.name !== undefined
          ? { name: data.name.trim() }
          : {}),
        updated_at: new Date(),
      },
      include: {
        role: true,
      },
    });

    return PrismaUserMapper.toDomain(raw);
  }
    async deactivate(
    id: string,
    ): Promise<{
    deactivatedAt: Date;
    sessionVersion: number;
    }> {
    const deactivatedAt = new Date();

    const updated =
      await this.prisma.user.update({
        where: {
          id_user: id,
        },
        data: {
          status: UserStatus.DEACTIVATED,
          deactivated_at: deactivatedAt,

          /*
          * Revokes every JWT issued
          * earlier.
          */
          session_version: {
            increment: 1,
          },

          locked_until: null,
          failed_login_attempts: 0,
          updated_at: deactivatedAt,
        },
        select: {
          deactivated_at: true,
          session_version: true,
        },
      });

      return {
        deactivatedAt:
          updated.deactivated_at ??
          deactivatedAt,

        sessionVersion:
          updated.session_version,
      };
    }

  async incrementSessionVersion(
    id: string,
  ): Promise<number> {
    const updated =
      await this.prisma.user.update({
        where: {
          id_user: id,
        },

        data: {
          session_version: {
            increment: 1,
          },

          updated_at:
            new Date(),
        },

        select: {
          session_version:
            true,
        },
      });

    return updated.session_version;
  }
}