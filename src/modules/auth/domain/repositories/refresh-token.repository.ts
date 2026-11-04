import { RefreshToken } from '../entities/refresh-token.entity';

export interface CreateRefreshTokenData {
  userId: string;
  tokenHash: string;
  familyId: string;
  sessionVersion: number;
  expiresAt: Date;
}

export abstract class RefreshTokenRepository {
  abstract hasActiveFamily(
    userId: string,
    familyId: string,
    sessionVersion: number,
  ): Promise<boolean>;

  // Atomically checks and replaces an unused token while holding the family lock.
  abstract rotate(
    previousTokenId: string,
    data: CreateRefreshTokenData,
  ): Promise<boolean>;

  abstract create(data: CreateRefreshTokenData): Promise<RefreshToken>;

  abstract findByHash(tokenHash: string): Promise<RefreshToken | null>;

  abstract revoke(id: string, replacedByTokenHash?: string): Promise<void>;

  abstract revokeFamily(familyId: string): Promise<void>;

  abstract revokeAllByUser(userId: string): Promise<void>;

  abstract markAsUsed(id: string): Promise<void>;
}
