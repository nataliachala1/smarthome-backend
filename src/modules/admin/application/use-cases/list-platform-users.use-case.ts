import { Injectable } from '@nestjs/common';

import {
  AdminReadRepository,
  AdminUserSummary,
} from '../../domain/repositories/admin-read.repository';

export const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class ListPlatformUsersUseCase {
  constructor(private readonly repository: AdminReadRepository) {}

  execute(
    adminUserId: string,
    limit = DEFAULT_PAGE_SIZE,
    offset = 0,
  ): Promise<AdminUserSummary[]> {
    return this.repository.listUsers(adminUserId, { limit, offset });
  }
}
