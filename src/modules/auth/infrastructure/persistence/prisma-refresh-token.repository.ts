import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../infrastructure/database/prisma/prisma.service';

import {
  CreateRefreshTokenData,
  RefreshTokenRepository,
} from '../../domain/repositories/refresh-token.repository';

import { RefreshToken } from '../../domain/entities/refresh-token.entity';

import { PrismaRefreshTokenMapper } from './prisma-refresh-token.mapper';

@Injectable()
export class PrismaRefreshTokenRepository
  implements RefreshTokenRepository
{
  constructor(
    private readonly prisma:
      PrismaService,
  ) {}

  async create(
    data: CreateRefreshTokenData,
  ): Promise<RefreshToken> {
    const raw =
      await this.prisma.refresh_token.create({
        data: {
          id_user: data.userId,
          token_hash:
            data.tokenHash,
          family_id:
            data.familyId,
          session_version:
            data.sessionVersion,
          expires_at:
            data.expiresAt,
        },
      });

    return PrismaRefreshTokenMapper.toDomain(
      raw,
    );
  }

  async findByHash(
    tokenHash: string,
  ): Promise<RefreshToken | null> {
    const raw =
      await this.prisma.refresh_token.findUnique({
        where: {
          token_hash:
            tokenHash,
        },
      });

    return raw
      ? PrismaRefreshTokenMapper.toDomain(
          raw,
        )
      : null;
  }

  async revoke(
    id: string,
    replacedByTokenHash?: string,
  ): Promise<void> {
    await this.prisma.refresh_token.update({
      where: {
        id_refresh_token: id,
      },
      data: {
        revoked_at: new Date(),

        replaced_by_token_hash:
          replacedByTokenHash ??
          null,
      },
    });
  }

  async revokeFamily(
    familyId: string,
  ): Promise<void> {
    await this.prisma.refresh_token.updateMany({
      where: {
        family_id: familyId,
        revoked_at: null,
      },
      data: {
        revoked_at:
          new Date(),
      },
    });
  }

  async revokeAllByUser(
    userId: string,
  ): Promise<void> {
    await this.prisma.refresh_token.updateMany({
      where: {
        id_user: userId,
        revoked_at: null,
      },
      data: {
        revoked_at:
          new Date(),
      },
    });
  }

  async markAsUsed(
    id: string,
  ): Promise<void> {
    await this.prisma.refresh_token.update({
      where: {
        id_refresh_token: id,
      },
      data: {
        last_used_at:
          new Date(),
      },
    });
  }
}