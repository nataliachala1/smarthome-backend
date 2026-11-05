import { recovery_token as PrismaRecoveryToken } from '../../../../../generated/prisma/client';

import { RecoveryToken } from '../../domain/entities/recovery-token.entity';
import { RecoveryTokenType } from '../../domain/ports/recovery-token-type.enum';

export class PrismaRecoveryTokenMapper {
  static toDomain(raw: PrismaRecoveryToken): RecoveryToken {
    return new RecoveryToken({
      id: raw.id_recovery_token,
      userId: raw.id_user,
      tokenHash: raw.token_hash,
      type: raw.type as RecoveryTokenType,
      expiresAt: raw.expires_at,
      usedAt: raw.used_at,
      createdAt: raw.created_at,
    });
  }
}
