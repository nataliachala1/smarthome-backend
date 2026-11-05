import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { RealtimeEventsService } from './realtime-events.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeSessionService } from './realtime-session.service';
import { RealtimeAccessService } from './realtime-access.service';
import { SessionRevocationModule } from '../../security/session-revocation.module';

@Module({
  imports: [AuthModule, SessionRevocationModule],
  providers: [
    RealtimeGateway,
    RealtimeEventsService,
    RealtimeSessionService,
    RealtimeAccessService,
  ],
  exports: [RealtimeEventsService],
})
export class RealtimeModule {}
