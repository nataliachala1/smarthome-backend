import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ListNotificationsUseCase } from './application/use-cases/list-notifications.use-case';
import { NotificationsController } from './presentation/controllers/notifications.controller';
import { UpdateNotificationStatusUseCase } from './application/use-cases/update-notification-status.use-case';
import { GetUnreadNotificationsCountUseCase } from './application/use-cases/get-unread-notifications-count.use-case';
import { MarkAllNotificationsAsReadUseCase } from './application/use-cases/mark-all-notifications-as-read.use-case';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [NotificationsController],
  providers: [
    ListNotificationsUseCase,
    UpdateNotificationStatusUseCase,
    GetUnreadNotificationsCountUseCase,
    MarkAllNotificationsAsReadUseCase,
  ],
})
export class NotificationsModule {}