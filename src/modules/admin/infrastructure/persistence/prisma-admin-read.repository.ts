import { ForbiddenException, Injectable } from '@nestjs/common';

import { Prisma } from '../../../../../generated/prisma/client';
import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';
import {
  AdminReadRepository,
  AdminUserSummary,
  AuditEventSummary,
  PageRequest,
} from '../../domain/repositories/admin-read.repository';

interface UserRow {
  id_user: string;
  name: string;
  email: string;
  role_name: string;
  status: string;
  email_verified: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

interface AuditRow {
  id_audit_log: string;
  id_user: string | null;
  id_home: string | null;
  actor_type: string;
  action: string;
  module: string;
  result: string | null;
  created_at: Date;
}

@Injectable()
export class PrismaAdminReadRepository implements AdminReadRepository {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  listUsers(adminUserId: string, page: PageRequest): Promise<AdminUserSummary[]> {
    return this.prismaRls.withUserContext(adminUserId, async (tx) => {
      await assertSystemAdmin(tx);
      const rows = await tx.$queryRaw<UserRow[]>`
        SELECT u.id_user, u.name, u.email, r.name AS role_name, u.status,
               u.email_verified, u.last_login_at, u.created_at
        FROM auth."user" u
        JOIN auth.role r ON r.id_role = u.id_role
        ORDER BY u.created_at DESC, u.id_user
        LIMIT ${page.limit} OFFSET ${page.offset}
      `;
      return rows.map((row) => ({
        id: row.id_user,
        name: row.name,
        email: row.email,
        role: row.role_name,
        status: row.status,
        emailVerified: row.email_verified,
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
      }));
    });
  }

  listAuditEvents(adminUserId: string, page: PageRequest): Promise<AuditEventSummary[]> {
    return this.prismaRls.withUserContext(adminUserId, async (tx) => {
      await assertSystemAdmin(tx);
      // RLS on identity_audit.audit_log also limits SELECT to SYSTEM_ADMIN.
      const rows = await tx.$queryRaw<AuditRow[]>`
        SELECT id_audit_log, id_user, id_home, actor_type, action, module, result, created_at
        FROM identity_audit.audit_log
        ORDER BY created_at DESC, id_audit_log
        LIMIT ${page.limit} OFFSET ${page.offset}
      `;
      return rows.map((row) => ({
        id: row.id_audit_log,
        userId: row.id_user,
        homeId: row.id_home,
        actorType: row.actor_type,
        action: row.action,
        module: row.module,
        result: row.result,
        createdAt: row.created_at,
      }));
    });
  }
}

/** Defense in depth: the database confirms the role, not only the JWT. */
async function assertSystemAdmin(tx: Prisma.TransactionClient): Promise<void> {
  const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`
    SELECT auth.fn_is_system_admin() AS allowed
  `;
  if (!row?.allowed) {
    throw new ForbiddenException('No tienes permisos para acceder a este recurso');
  }
}
