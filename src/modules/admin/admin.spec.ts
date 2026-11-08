jest.mock('../auth/presentation/http/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));
jest.mock('../../infrastructure/database/prisma/prisma-rls.service', () => ({
  PrismaRlsService: class PrismaRlsService {},
}));

import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { JwtAuthGuard } from '../auth/presentation/http/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/presentation/http/guards/roles.guard';
import { ROLES_KEY } from '../auth/presentation/http/decorators/roles.decorator';
import { ListAuditEventsUseCase } from './application/use-cases/list-audit-events.use-case';
import { ListPlatformUsersUseCase } from './application/use-cases/list-platform-users.use-case';
import { AdminReadRepository } from './domain/repositories/admin-read.repository';
import { PrismaAdminReadRepository } from './infrastructure/persistence/prisma-admin-read.repository';
import { AdminController, SYSTEM_ADMIN_ROLE } from './presentation/http/admin.controller';

const adminId = 'd0000000-0000-4000-8000-000000000001';

function repositoryMock() {
  const listUsers = jest.fn().mockResolvedValue([]);
  const listAuditEvents = jest.fn().mockResolvedValue([]);
  const repository: AdminReadRepository = { listUsers, listAuditEvents };
  return { repository, listUsers, listAuditEvents };
}

describe('Admin use cases', () => {
  it('lists users with the default page', async () => {
    const { repository, listUsers } = repositoryMock();
    await new ListPlatformUsersUseCase(repository).execute(adminId);
    expect(listUsers).toHaveBeenCalledWith(adminId, { limit: 50, offset: 0 });
  });

  it('lists audit events with an explicit page', async () => {
    const { repository, listAuditEvents } = repositoryMock();
    await new ListAuditEventsUseCase(repository).execute(adminId, 10, 20);
    expect(listAuditEvents).toHaveBeenCalledWith(adminId, { limit: 10, offset: 20 });
  });
});

describe('AdminController', () => {
  it('requires a valid JWT and the SYSTEM_ADMIN role', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, AdminController)).toEqual([SYSTEM_ADMIN_ROLE]);
  });

  it('delegates to the use cases with the caller identity', async () => {
    const users = { execute: jest.fn().mockResolvedValue(['u']) };
    const audit = { execute: jest.fn().mockResolvedValue(['a']) };
    const controller = new AdminController(
      users as unknown as ListPlatformUsersUseCase,
      audit as unknown as ListAuditEventsUseCase,
    );
    const caller = { userId: adminId, role: SYSTEM_ADMIN_ROLE };

    await expect(controller.listUsers(caller, { limit: 5 })).resolves.toEqual(['u']);
    await expect(controller.listAuditEvents(caller, { offset: 3 })).resolves.toEqual(['a']);
    expect(users.execute).toHaveBeenCalledWith(adminId, 5, undefined);
    expect(audit.execute).toHaveBeenCalledWith(adminId, undefined, 3);
  });
});

describe('PrismaAdminReadRepository', () => {
  function repositoryWith(isAdmin: boolean, rows: unknown[]) {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ allowed: isAdmin }])
      .mockResolvedValueOnce(rows);
    const tx = { $queryRaw: queryRaw };
    const prismaRls = {
      withUserContext: jest.fn((userId: string, operation: (client: unknown) => unknown) => operation(tx)),
    };
    return {
      repository: new PrismaAdminReadRepository(prismaRls as never),
      prismaRls,
      queryRaw,
    };
  }

  it('maps user rows after the database confirms the admin role', async () => {
    const createdAt = new Date('2026-11-07T00:00:00Z');
    const { repository, prismaRls } = repositoryWith(true, [
      {
        id_user: 'u1',
        name: 'Demo Owner',
        email: 'owner@example.com',
        role_name: 'USER',
        status: 'ACTIVE',
        email_verified: true,
        last_login_at: null,
        created_at: createdAt,
      },
    ]);

    await expect(repository.listUsers(adminId, { limit: 10, offset: 0 })).resolves.toEqual([
      {
        id: 'u1',
        name: 'Demo Owner',
        email: 'owner@example.com',
        role: 'USER',
        status: 'ACTIVE',
        emailVerified: true,
        lastLoginAt: null,
        createdAt,
      },
    ]);
    expect(prismaRls.withUserContext).toHaveBeenCalledWith(adminId, expect.any(Function));
  });

  it('maps audit rows', async () => {
    const createdAt = new Date();
    const { repository } = repositoryWith(true, [
      {
        id_audit_log: 'a1',
        id_user: null,
        id_home: null,
        actor_type: 'SYSTEM',
        action: 'AUTH_LOGIN_FAILED',
        module: 'AUTH',
        result: 'FAILURE',
        created_at: createdAt,
      },
    ]);

    await expect(repository.listAuditEvents(adminId, { limit: 1, offset: 0 })).resolves.toEqual([
      {
        id: 'a1',
        userId: null,
        homeId: null,
        actorType: 'SYSTEM',
        action: 'AUTH_LOGIN_FAILED',
        module: 'AUTH',
        result: 'FAILURE',
        createdAt,
      },
    ]);
  });

  it.each(['listUsers', 'listAuditEvents'] as const)(
    '%s refuses callers that the database does not recognize as SYSTEM_ADMIN',
    async (method) => {
      const { repository, queryRaw } = repositoryWith(false, []);
      await expect(repository[method](adminId, { limit: 1, offset: 0 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(queryRaw).toHaveBeenCalledTimes(1);
    },
  );
});
