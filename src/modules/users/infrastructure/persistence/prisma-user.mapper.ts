import { User } from '../../domain/entities/user.entity';
import { UserStatus } from '../../domain/entities/user-status.enum';

export interface PrismaUserWithRole {
  id_user: string;
  id_role: string;
  name: string;
  email: string;
  password_hash: string;
  status: string;
  email_verified: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  deactivated_at: Date | null;
  created_at: Date;
  updated_at: Date;
  role: {
    name: string;
  };
}

export class PrismaUserMapper {
  static toDomain(raw: PrismaUserWithRole): User {
    return new User({
      id: raw.id_user,
      roleId: raw.id_role,
      roleName: raw.role.name,
      name: raw.name,
      email: raw.email,
      passwordHash: raw.password_hash,
      status: raw.status as UserStatus,
      emailVerified: raw.email_verified,
      failedLoginAttempts: raw.failed_login_attempts,
      lockedUntil: raw.locked_until,
      lastLoginAt: raw.last_login_at,
      deactivatedAt: raw.deactivated_at,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    });
  }
}