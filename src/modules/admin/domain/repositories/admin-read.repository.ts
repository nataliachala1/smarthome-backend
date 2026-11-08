export interface AdminUserSummary {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AuditEventSummary {
  id: string;
  userId: string | null;
  homeId: string | null;
  actorType: string;
  action: string;
  module: string;
  result: string | null;
  createdAt: Date;
}

export interface PageRequest {
  limit: number;
  offset: number;
}

/**
 * Read-only platform data for the global SYSTEM_ADMIN role.
 *
 * Implementations must run under the caller's database identity so that
 * PostgreSQL row-level security (auth.fn_is_system_admin) is enforced too.
 */
export abstract class AdminReadRepository {
  abstract listUsers(adminUserId: string, page: PageRequest): Promise<AdminUserSummary[]>;

  abstract listAuditEvents(
    adminUserId: string,
    page: PageRequest,
  ): Promise<AuditEventSummary[]>;
}
