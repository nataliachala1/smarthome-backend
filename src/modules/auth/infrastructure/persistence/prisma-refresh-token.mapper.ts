import { refresh_token as PrismaRefreshToken } from '../../../../../generated/prisma/client';

import { RefreshToken } from '../../domain/entities/refresh-token.entity';

export class PrismaRefreshTokenMapper {
  static toDomain(
    raw: PrismaRefreshToken,
  ): RefreshToken {
    return new RefreshToken({
      id: raw.id_refresh_token,
      userId: raw.id_user,
      tokenHash: raw.token_hash,
      familyId: raw.family_id,
      sessionVersion:
        raw.session_version,
      expiresAt: raw.expires_at,
      revokedAt: raw.revoked_at,
      replacedByTokenHash:
        raw.replaced_by_token_hash,
      createdAt: raw.created_at,
      lastUsedAt:
        raw.last_used_at,
    });
  }
}