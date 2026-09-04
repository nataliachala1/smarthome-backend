import { UserStatus } from './user-status.enum';

export interface UserProps {
  id: string;
  roleId: string;
  roleName: string;
  name: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  emailVerified: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}


export class User {
  constructor(private readonly props: UserProps) {}

  get id(): string {
    return this.props.id;
  }

  get roleId(): string {
    return this.props.roleId;
  }

  get roleName(): string {
  return this.props.roleName;
 }

  get name(): string {
    return this.props.name;
  }

  get email(): string {
    return this.props.email;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get emailVerified(): boolean {
    return this.props.emailVerified;
  }

  get failedLoginAttempts(): number {
    return this.props.failedLoginAttempts;
  }

  get lockedUntil(): Date | null {
    return this.props.lockedUntil;
  }

  get lastLoginAt(): Date | null {
    return this.props.lastLoginAt;
  }

  get deactivatedAt(): Date | null {
    return this.props.deactivatedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}