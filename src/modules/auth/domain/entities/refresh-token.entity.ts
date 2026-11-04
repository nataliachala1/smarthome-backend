export interface RefreshTokenProps {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  sessionVersion: number;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenHash: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export class RefreshToken {
  constructor(
    private readonly props: RefreshTokenProps,
  ) {}

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get familyId(): string {
    return this.props.familyId;
  }

  get sessionVersion(): number {
    return this.props.sessionVersion;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt;
  }

  get replacedByTokenHash(): string | null {
    return this.props.replacedByTokenHash;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get lastUsedAt(): Date | null {
    return this.props.lastUsedAt;
  }

  get isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  get isExpired(): boolean {
    return this.props.expiresAt <= new Date();
  }
}