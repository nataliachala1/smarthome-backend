import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class RealtimeEventsService {
  private readonly logger = new Logger(RealtimeEventsService.name);
  private server: Server | null = null;

  bindServer(server: Server): void {
    this.server = server;
    this.logger.log('Servidor realtime inicializado');
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.warn(
        `No se emitió evento ${event}. Servidor realtime no inicializado.`,
      );
      return;
    }

    this.server.to(this.userRoom(userId)).emit(event, payload);
  }

  userRoom(userId: string): string {
    return `user:${userId}`;
  }
}