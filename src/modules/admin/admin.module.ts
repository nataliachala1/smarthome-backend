import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ListAuditEventsUseCase } from './application/use-cases/list-audit-events.use-case';
import { ListPlatformUsersUseCase } from './application/use-cases/list-platform-users.use-case';
import { AdminReadRepository } from './domain/repositories/admin-read.repository';
import { PrismaAdminReadRepository } from './infrastructure/persistence/prisma-admin-read.repository';
import { AdminController } from './presentation/http/admin.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [
    ListPlatformUsersUseCase,
    ListAuditEventsUseCase,
    { provide: AdminReadRepository, useClass: PrismaAdminReadRepository },
  ],
})
export class AdminModule {}
