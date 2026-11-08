import { User } from '../modules/users/domain/entities/user.entity';
import { UserStatus } from '../modules/users/domain/entities/user-status.enum';

/** Builds a domain user for unit tests; every field can be overridden. */
export function makeUser(overrides: Partial<ConstructorParameters<typeof User>[0]> = {}): User {
  return new User({
    id: 'u1',
    roleId: 'role-user',
    roleName: 'USER',
    name: 'Ana',
    email: 'ana@example.com',
    passwordHash: 'hash',
    status: UserStatus.ACTIVE,
    emailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    deactivatedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    sessionVersion: 3,
    ...overrides,
  });
}

/** Returns an object whose listed methods are jest mocks resolving to undefined. */
export function mockOf<T extends string>(...methods: T[]): Record<T, jest.Mock> {
  return Object.fromEntries(methods.map((m) => [m, jest.fn().mockResolvedValue(undefined)])) as Record<T, jest.Mock>;
}
