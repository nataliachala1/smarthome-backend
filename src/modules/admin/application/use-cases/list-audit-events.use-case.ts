import { Injectable } from '@nestjs/common';

import {
  AdminReadRepository,
  AuditEventSummary,
} from '../../domain/repositories/admin-read.repository';
import { DEFAULT_PAGE_SIZE } from './list-platform-users.use-case';

@Injectable()
export class ListAuditEventsUseCase {
  constructor(private readonly repository: AdminReadRepository) {}

  execute(
    adminUserId: string,
    limit = DEFAULT_PAGE_SIZE,
    offset = 0,
  ): Promise<AuditEventSummary[]> {
    return this.repository.listAuditEvents(adminUserId, { limit, offset });
  }
}
