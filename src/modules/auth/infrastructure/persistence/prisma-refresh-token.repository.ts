import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../infrastructure/database/prisma/prisma.service';

import {
  CreateRefreshTokenData,
  RefreshTokenRepository,
} from '../../domain/repositories/refresh-token.repository';

import { RefreshToken } from '../../domain/entities/refresh-token.entity';

import { PrismaRefreshTokenMapper } from './prisma-refresh-token.mapper';

@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async hasActiveFamily(
    userId: string,
    familyId: string,
    sessionVersion: number,
  ): Promise<boolean> {
    const token = await this.prisma.refresh_token.findFirst({
      where: {
        id_user: userId,
        family_id: familyId,
        session_version: sessionVersion,
        revoked_at: null,
        expires_at: { gt: new Date() },
      },
      select: { id_refresh_token: true },
    });
    return token !== null;
  }

  async rotate(
    previousTokenId: string,
    data: CreateRefreshTokenData,
  ): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.familyId}::text, 0))`;
        const previous = await tx.refresh_token.findUnique({
          where: { id_refresh_token: previousTokenId },
        });
        if (
          !previous ||
          previous.family_id !== data.familyId ||
          previous.id_user !== data.userId ||
          previous.session_version !== data.sessionVersion ||
          previous.revoked_at !== null ||
          previous.expires_at <= new Date()
        )
          return false;
        await tx.refresh_token.create({
          data: {
            id_user: data.userId,
            token_hash: data.tokenHash,
            family_id: data.familyId,
            session_version: data.sessionVersion,
            expires_at: data.expiresAt,
          },
        });
        await tx.refresh_token.update({
          where: { id_refresh_token: previousTokenId },
          data: {
            revoked_at: new Date(),
            replaced_by_token_hash: data.tokenHash,
            last_used_at: new Date(),
          },
        });
        return true;
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async create(data: CreateRefreshTokenData): Promise<RefreshToken> {
    const raw = await this.prisma.refresh_token.create({
      data: {
        id_user: data.userId,
        token_hash: data.tokenHash,
        family_id: data.familyId,
        session_version: data.sessionVersion,
        expires_at: data.expiresAt,
      },
    });

    return PrismaRefreshTokenMapper.toDomain(raw);
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const raw = await this.prisma.refresh_token.findUnique({
      where: {
        token_hash: tokenHash,
      },
    });

    return raw ? PrismaRefreshTokenMapper.toDomain(raw) : null;
  }

  async revoke(id: string, replacedByTokenHash?: string): Promise<void> {
    await this.prisma.refresh_token.update({
      where: {
        id_refresh_token: id,
      },
      data: {
        revoked_at: new Date(),

        replaced_by_token_hash: replacedByTokenHash ?? null,
      },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${familyId}::text, 0))`;
        await tx.refresh_token.updateMany({
          where: {
            family_id: familyId,
            revoked_at: null,
          },
          data: {
            revoked_at: new Date(),
          },
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async revokeAllByUser(userId: string): Promise<void> {
    await this.prisma.refresh_token.updateMany({
      where: {
        id_user: userId,
        revoked_at: null,
      },
      data: {
        revoked_at: new Date(),
      },
    });
  }

  async markAsUsed(id: string): Promise<void> {
    await this.prisma.refresh_token.update({
      where: {
        id_refresh_token: id,
      },
      data: {
        last_used_at: new Date(),
      },
    });
  }
}
