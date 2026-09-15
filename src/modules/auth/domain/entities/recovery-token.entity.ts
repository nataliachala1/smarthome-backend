import { RecoveryTokenType } from '../ports/recovery-token-type.enum';

export interface RecoveryTokenProps {
  id: string;
  userId: string;
  tokenHash: string;
  type: RecoveryTokenType;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export class RecoveryToken {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly type: RecoveryTokenType;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly createdAt: Date;

  constructor(props: RecoveryTokenProps) {
    this.id = props.id;
    this.userId = props.userId;
    this.tokenHash = props.tokenHash;
    this.type = props.type;
    this.expiresAt = props.expiresAt;
    this.usedAt = props.usedAt;
    this.createdAt = props.createdAt;
  }
}

export interface CreateRecoveryTokenData {
  userId: string;
  tokenHash: string;
  type: RecoveryTokenType;
  expiresAt: Date;
}

export abstract class RecoveryTokenRepository {
  abstract create(data: CreateRecoveryTokenData): Promise<RecoveryToken>;

  abstract findValidByHashAndType(
    tokenHash: string,
    type: RecoveryTokenType,
  ): Promise<RecoveryToken | null>;

  abstract invalidateUnusedByUserAndType(
    userId: string,
    type: RecoveryTokenType,
  ): Promise<void>;

  abstract markAsUsed(id: string): Promise<void>;
}
