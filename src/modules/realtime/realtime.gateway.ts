import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { RealtimeEventsService } from './realtime-events.service';

interface JwtPayload {
  sub: string;
  role: string;
  iat?: number;
  exp?: number;
}

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly realtimeEventsService: RealtimeEventsService,
  ) {}

  afterInit(server: Server): void {
    this.realtimeEventsService.bindServer(server);
    this.logger.log('Gateway realtime inicializado');
  }

async handleConnection(client: Socket): Promise<void> {
  const token = this.extractToken(client);

  if (!token) {
    this.logger.warn(`Conexion realtime rechazada sin token: ${client.id}`);
    client.emit('realtime.error', {
      message: 'Token de autenticacion requerido',
    });
    client.disconnect(true);
    return;
  }

  try {
    const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

    client.data.user = {
      userId: payload.sub,
      role: payload.role,
    };

    await client.join(this.realtimeEventsService.userRoom(payload.sub));

    client.emit('realtime.connected', {
      userId: payload.sub,
    });

    this.logger.log(
      `Cliente realtime conectado: ${client.id}; userId=${payload.sub}`,
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error desconocido';

    this.logger.warn(
      `Conexion realtime rechazada por JWT invalido: ${message}`,
    );

    client.emit('realtime.error', {
      message: 'Token invalido o expirado',
    });

    client.disconnect(true);
  }
}

  handleDisconnect(client: Socket): void {
    this.logger.log(`Cliente realtime desconectado: ${client.id}`);
  }

  private extractToken(client: Socket): string | null {
  const tokenFromAuth = client.handshake.auth.token;

  if (typeof tokenFromAuth === 'string') {
    return this.normalizeToken(tokenFromAuth);
  }

  const authorization = client.handshake.headers.authorization;

  if (!authorization || Array.isArray(authorization)) {
    return null;
  }

  const [type, token] = authorization.split(' ');

  if (type !== 'Bearer' || !token) {
    return null;
  }

  return this.normalizeToken(token);
}

private normalizeToken(value: string): string | null {
  let token = value.trim();

  token = token.replace(/^['"]|['"]$/g, '').trim();
  token = token.replace(/^Bearer\s+/i, '').trim();
  token = token.replace(/^['"]|['"]$/g, '').trim();

  return token.length > 0 ? token : null;
}
}