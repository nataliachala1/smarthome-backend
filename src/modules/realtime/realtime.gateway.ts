import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Namespace } from 'socket.io';
import {
  RealtimeAuthError,
  RealtimeSessionService,
  RealtimeSocket,
} from './realtime-session.service';

@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  constructor(private readonly sessions: RealtimeSessionService) {}

  afterInit(namespace: Namespace): void {
    namespace.use((socket: RealtimeSocket, next) => {
      void this.sessions
        .authenticate(this.extractToken(socket))
        .then((identity) => {
          socket.data.identity = identity;
          next();
        })
        .catch((error: unknown) => {
          const code =
            error instanceof RealtimeAuthError
              ? error.code
              : 'REALTIME_UNAVAILABLE';
          next(
            Object.assign(new Error('No se pudo validar la sesión realtime.'), {
              data: { code },
            }),
          );
        });
    });
  }

  async handleConnection(client: RealtimeSocket): Promise<void> {
    if (!(await this.sessions.register(client))) return;
    const identity = client.data.identity!;
    await client.join(`user:${identity.userId}`);
    if (client.connected)
      client.emit('realtime.connected', { userId: identity.userId });
  }

  handleDisconnect(client: RealtimeSocket): void {
    this.sessions.remove(client);
  }

  private extractToken(client: RealtimeSocket): string | null {
    const authToken: unknown = client.handshake.auth.token;
    if (typeof authToken === 'string') return this.normalizeToken(authToken);
    const authorization = client.handshake.headers.authorization;
    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ')
    )
      return null;
    return this.normalizeToken(authorization.slice(7));
  }

  private normalizeToken(value: string): string | null {
    const token = value
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .trim()
      .replace(/^Bearer\s+/i, '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .trim();
    return token.length > 0 ? token : null;
  }
}
