import { User } from '../entities/user.entity';
import { UserStatus } from '../entities/user-status.enum';

export interface CreateUserData {
  name: string;
  email: string;
  passwordHash: string;
}

export interface UpdateUserProfileData {
  name?: string;
  email?: string;
}

export abstract class UserRepository {
  abstract findByEmail(email: string): Promise<User | null>;

  abstract findById(id: string): Promise<User | null>;

  abstract create(data: CreateUserData): Promise<User>;

  abstract activate(id: string): Promise<void>;

  abstract resetExpiredLock(id: string): Promise<void>;

  abstract registerFailedLogin(
    id: string,
    failedAttempts: number,
    lockedUntil: Date | null,
    status: UserStatus,
  ): Promise<void>;

  abstract registerSuccessfulLogin(
    id: string,
  ): Promise<void>;

  abstract updatePassword(
    id: string,
    passwordHash: string,
  ): Promise<void>;

  abstract updateProfile(
    id: string,
    data: UpdateUserProfileData,
  ): Promise<User>;
}