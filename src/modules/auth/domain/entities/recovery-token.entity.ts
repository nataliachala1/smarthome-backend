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
  constructor(private readonly props: RecoveryTokenProps) {}

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get type(): RecoveryTokenType {
    return this.props.type;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get usedAt(): Date | null {
    return this.props.usedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  isExpired(now = new Date()): boolean {
    return this.props.expiresAt <= now;
  }

  isUsed(): boolean {
    return this.props.usedAt !== null;
  }
}