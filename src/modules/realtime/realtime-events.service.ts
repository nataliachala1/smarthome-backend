import { Injectable, Logger } from '@nestjs/common';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeSessionService } from './realtime-session.service';

@Injectable()
export class RealtimeEventsService {
  private readonly logger = new Logger(RealtimeEventsService.name);

  constructor(
    private readonly sessions: RealtimeSessionService,
    private readonly access: RealtimeAccessService,
  ) {}

  // Preserve the best-effort publisher contract; failures suppress delivery.
  emitToUser(userId: string, event: string, payload: unknown): void {
    void this.deliver(userId, event, payload).catch(() => {
      this.logger.warn('No se pudo autorizar una entrega realtime.');
    });
  }

  private async deliver(
    userId: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    if (!this.sessions.hasUser(userId)) return;
    if (!(await this.access.canReceive(userId, event, payload))) return;
    const sockets = await this.sessions.authorizedSockets(userId);
    for (const socket of sockets) {
      if (socket.connected) socket.emit(event, payload);
    }
  }
}
