import { RecoveryToken } from '../entities/recovery-token.entity';
import { RecoveryTokenType } from '../ports/recovery-token-type.enum';

export interface CreateRecoveryTokenData {
  userId: string;
  tokenHash: string;
  type: RecoveryTokenType;
  expiresAt: Date;
}

export abstract class RecoveryTokenRepository {
  abstract create(
    data: CreateRecoveryTokenData,
  ): Promise<RecoveryToken>;

  abstract findValidByHashAndType(
    tokenHash: string,
    type: RecoveryTokenType,
  ): Promise<RecoveryToken | null>;

  abstract invalidateUnusedByUserAndType(
  userId: string,
  type: RecoveryTokenType,
  ): Promise<void>;
}