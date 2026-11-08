import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import { Roles } from '../../../auth/presentation/http/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/presentation/http/guards/roles.guard';
import { PageQueryDto } from '../../application/dto/page-query.dto';
import { ListAuditEventsUseCase } from '../../application/use-cases/list-audit-events.use-case';
import { ListPlatformUsersUseCase } from '../../application/use-cases/list-platform-users.use-case';

export const SYSTEM_ADMIN_ROLE = 'SYSTEM_ADMIN';

@Controller('api/v1/admin')
@ApiTags('admin')
@ApiBearerAuth('access-token')
@ApiForbiddenResponse({ description: 'The caller is not a SYSTEM_ADMIN' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SYSTEM_ADMIN_ROLE)
export class AdminController {
  constructor(
    private readonly listPlatformUsersUseCase: ListPlatformUsersUseCase,
    private readonly listAuditEventsUseCase: ListAuditEventsUseCase,
  ) {}

  @Get('users')
  @ApiOperation({ summary: 'List platform users with their global role and status' })
  @ApiOkResponse({ description: 'Paginated list of users' })
  listUsers(@CurrentUser() user: AuthenticatedUser, @Query() query: PageQueryDto) {
    return this.listPlatformUsersUseCase.execute(user.userId, query.limit, query.offset);
  }

  @Get('audit-events')
  @ApiOperation({ summary: 'List the most recent identity audit events' })
  @ApiOkResponse({ description: 'Paginated list of audit events' })
  listAuditEvents(@CurrentUser() user: AuthenticatedUser, @Query() query: PageQueryDto) {
    return this.listAuditEventsUseCase.execute(user.userId, query.limit, query.offset);
  }
}
