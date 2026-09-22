import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../infrastructure/database/prisma/prisma.service';

import {
  CreateUserData,
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

  async create(data: CreateUserData): Promise<User> {
    const normalizedEmail = data.email
      .trim()
      .toLowerCase();

    const rows = await this.prisma.$queryRaw<
      Array<{
        id_user: string;
        id_role: string;
        name: string;
        email: string;
        password_hash: string;
        status: string;
        email_verified: boolean;
        failed_login_attempts: number;
        locked_until: Date | null;
        last_login_at: Date | null;
        deactivated_at: Date | null;
        session_version: number;
        created_at: Date;
        updated_at: Date;
        role_name: string;
      }>
    >`
      WITH inserted AS (
        INSERT INTO auth."user" (
          name,
          email,
          password_hash
        )
        VALUES (
          ${data.name},
          ${normalizedEmail},
          ${data.passwordHash}
        )
        RETURNING
        id_user,
        id_role,
        name,
        email,
        password_hash,
        status,
        email_verified,
        failed_login_attempts,
        locked_until,
        last_login_at,
        deactivated_at,
        session_version,
        created_at,
        updated_at
      )
      SELECT
      i.id_user,
      i.id_role,
      i.name,
      i.email,
      i.password_hash,
      i.status,
      i.email_verified,
      i.failed_login_attempts,
      i.locked_until,
      i.last_login_at,
      i.deactivated_at,
      i.session_version,
      i.created_at,
      i.updated_at,
      r.name AS role_name    
      FROM inserted i
      JOIN auth.role r
        ON r.id_role = i.id_role
    `;

    const raw = rows[0];

    if (!raw) {
      throw new Error(
        'No fue posible crear el usuario',
      );
    }

    return new User({
      id: raw.id_user,
      roleId: raw.id_role,
      roleName: raw.role_name,
      name: raw.name,
      email: raw.email,
      passwordHash: raw.password_hash,
      status: raw.status as UserStatus,
      emailVerified: raw.email_verified,
      failedLoginAttempts:
        raw.failed_login_attempts,
      lockedUntil: raw.locked_until,
      lastLoginAt: raw.last_login_at,
      deactivatedAt: raw.deactivated_at,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      sessionVersion: raw.session_version,
    });
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
    const normalizedEmail = data.email?.trim().toLowerCase();
    const raw = await this.prisma.user.update({
      where: { id_user: id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
        updated_at: new Date(),
      },
      include: { role: true },
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
          * Revoca todos los JWT emitidos
          * anteriormente.
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