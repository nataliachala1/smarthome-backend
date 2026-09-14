import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RealtimeEventsService } from './realtime-events.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, RealtimeEventsService],
  exports: [RealtimeEventsService],
})
export class RealtimeModule {}