import { Injectable } from '@nestjs/common';
import { recovery_token as PrismaRecoveryToken } from '../../../../../generated/prisma/client';

import { PrismaService } from '../../../../infrastructure/database/prisma/prisma.service';

import {
  CreateRecoveryTokenData,
  RecoveryTokenRepository,
} from '../../domain/repositories/recovery-token.repository';

import { RecoveryToken } from '../../domain/entities/recovery-token.entity';
import { RecoveryTokenType } from '../../domain/ports/recovery-token-type.enum';

import { PrismaRecoveryTokenMapper } from './prisma-recovery-token.mapper';

@Injectable()
export class PrismaRecoveryTokenRepository
  implements RecoveryTokenRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: CreateRecoveryTokenData,
  ): Promise<RecoveryToken> {
    const rows = await this.prisma.$queryRaw<PrismaRecoveryToken[]>`
      INSERT INTO auth.recovery_token (
        id_user,
        token_hash,
        type,
        expires_at
      )
      VALUES (
        ${data.userId},
        ${data.tokenHash},
        ${data.type},
        ${data.expiresAt}
      )
      RETURNING
        id_recovery_token,
        id_user,
        token_hash,
        type,
        expires_at,
        used_at,
        created_at
    `;

    const raw = rows[0];

    if (!raw) {
      throw new Error(
        'No fue posible crear el token de recuperación',
      );
    }

    return PrismaRecoveryTokenMapper.toDomain(raw);
  }

  async findValidByHashAndType(
    tokenHash: string,
    type: RecoveryTokenType,
  ): Promise<RecoveryToken | null> {
    const raw = await this.prisma.recovery_token.findFirst({
      where: {
        token_hash: tokenHash,
        type,
        used_at: null,
        expires_at: {
          gt: new Date(),
        },
      },
    });

    return raw
      ? PrismaRecoveryTokenMapper.toDomain(raw)
      : null;
  }
  
  async invalidateUnusedByUserAndType(
  userId: string,
  type: RecoveryTokenType,
  ): Promise<void> {
    await this.prisma.recovery_token.updateMany({
      where: {
        id_user: userId,
        type,
        used_at: null,
      },
      data: {
        used_at: new Date(),
      },
    });
  }
}