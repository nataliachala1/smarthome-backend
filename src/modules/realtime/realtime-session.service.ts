import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import type { Socket } from 'socket.io';
import { UserRepository } from '../users/domain/repositories/user.repository';
import { UserStatus } from '../users/domain/entities/user-status.enum';
import type { User } from '../users/domain/entities/user.entity';
import { SessionRevocationService } from '../../security/session-revocation.module';

export interface RealtimeIdentity {
  userId: string;
  role: string;
  sessionVersion: number;
  expiresAt: number;
}

type Events = Record<string, (...args: unknown[]) => void>;
export type RealtimeSocket = Socket<
  Events,
  Events,
  Events,
  { identity?: RealtimeIdentity }
>;
export type RealtimeErrorCode =
  | 'REALTIME_UNAUTHORIZED'
  | 'REALTIME_TOKEN_EXPIRED'
  | 'REALTIME_SESSION_REVOKED'
  | 'REALTIME_UNAVAILABLE';

export class RealtimeAuthError extends Error {
  constructor(readonly code: RealtimeErrorCode) {
    super('No se pudo validar la sesión realtime.');
  }
}

interface Session {
  socket: RealtimeSocket;
  identity: RealtimeIdentity;
  ready: boolean;
  timer?: NodeJS.Timeout;
}

@Injectable()
export class RealtimeSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly sessions = new Map<string, Session>();
  private timer?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private sweeping = false;

  constructor(
    private readonly jwt: JwtService,
    private readonly users: UserRepository,
    private readonly revocations: SessionRevocationService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.revocations.subscribe((userId, version) => {
      for (const session of this.sessions.values()) {
        if (
          session.identity.userId === userId &&
          session.identity.sessionVersion < version
        ) {
          this.reject(session.socket, 'REALTIME_SESSION_REVOKED');
        }
      }
    });
    this.timer = setInterval(() => {
      void this.revalidateConnections();
    }, 15_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
    for (const session of this.sessions.values()) this.remove(session.socket);
  }

  async authenticate(token: string | null): Promise<RealtimeIdentity> {
    if (!token) throw new RealtimeAuthError('REALTIME_UNAUTHORIZED');
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        algorithms: ['HS256'],
      });
    } catch {
      throw new RealtimeAuthError('REALTIME_UNAUTHORIZED');
    }
    if (
      typeof payload.sub !== 'string' ||
      !isUUID(payload.sub) ||
      typeof payload.role !== 'string' ||
      !payload.role ||
      typeof payload.sv !== 'number' ||
      !Number.isSafeInteger(payload.sv) ||
      payload.sv < 0 ||
      typeof payload.exp !== 'number' ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= 0
    )
      throw new RealtimeAuthError('REALTIME_UNAUTHORIZED');
    const identity = {
      userId: payload.sub,
      role: payload.role,
      sessionVersion: payload.sv,
      expiresAt: payload.exp * 1000,
    };
    const user = await this.findUser(identity.userId);
    const error = this.invalidSession(identity, user);
    if (error) throw new RealtimeAuthError(error);
    return identity;
  }

  async register(socket: RealtimeSocket): Promise<boolean> {
    const identity = socket.data.identity;
    if (!identity || !socket.connected) return false;
    const session: Session = { socket, identity, ready: false };
    this.sessions.set(socket.id, session);
    try {
      // Track pending registrations so local logout-all can cancel them.
      const user = await this.findUser(identity.userId);
      const error = this.invalidSession(identity, user);
      if (error) this.reject(socket, error);
      if (!this.isCurrent(session)) return false;
      session.ready = true;
      this.scheduleExpiration(session);
      return this.isCurrent(session);
    } catch {
      this.reject(socket, 'REALTIME_UNAVAILABLE');
      return false;
    }
  }

  hasUser(userId: string): boolean {
    return [...this.sessions.values()].some(
      (session) => session.ready && session.identity.userId === userId,
    );
  }

  async authorizedSockets(userId: string): Promise<RealtimeSocket[]> {
    const candidates = [...this.sessions.values()].filter(
      (session) => session.ready && session.identity.userId === userId,
    );
    if (!candidates.length) return [];
    let user: User | null;
    try {
      user = await this.findUser(userId);
    } catch {
      for (const session of candidates)
        this.reject(session.socket, 'REALTIME_UNAVAILABLE');
      return [];
    }
    return candidates.flatMap((session) => {
      const error = this.invalidSession(session.identity, user);
      if (error) this.reject(session.socket, error);
      return !error && this.isCurrent(session) ? [session.socket] : [];
    });
  }

  async revalidateConnections(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const userIds = new Set(
        [...this.sessions.values()].map((session) => session.identity.userId),
      );
      for (const userId of userIds) await this.authorizedSockets(userId);
    } finally {
      this.sweeping = false;
    }
  }

  remove(socket: RealtimeSocket): void {
    const session = this.sessions.get(socket.id);
    if (session?.timer) clearTimeout(session.timer);
    this.sessions.delete(socket.id);
  }

  reject(socket: RealtimeSocket, code: RealtimeErrorCode): void {
    this.remove(socket);
    socket.emit('realtime.error', {
      code,
      message: 'La sesión realtime debe volver a autenticarse.',
    });
    socket.disconnect(true);
  }

  private async findUser(userId: string): Promise<User | null> {
    try {
      return await this.users.findById(userId);
    } catch {
      throw new RealtimeAuthError('REALTIME_UNAVAILABLE');
    }
  }

  private invalidSession(
    identity: RealtimeIdentity,
    user: User | null,
  ): RealtimeErrorCode | null {
    if (identity.expiresAt <= Date.now()) return 'REALTIME_TOKEN_EXPIRED';
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      user.sessionVersion !== identity.sessionVersion ||
      user.roleName !== identity.role
    ) {
      return 'REALTIME_SESSION_REVOKED';
    }
    return null;
  }

  private isCurrent(session: Session): boolean {
    return (
      session.socket.connected &&
      this.sessions.get(session.socket.id) === session
    );
  }

  private scheduleExpiration(session: Session): void {
    const remaining = session.identity.expiresAt - Date.now();
    if (remaining <= 0) {
      this.reject(session.socket, 'REALTIME_TOKEN_EXPIRED');
      return;
    }
    session.timer = setTimeout(
      () => this.scheduleExpiration(session),
      Math.min(remaining, 2_147_483_647),
    );
    session.timer.unref();
  }
}
