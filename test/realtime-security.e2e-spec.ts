import { INestApplication, Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import type { Server } from 'node:http';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway';
import { RealtimeSessionService } from '../src/modules/realtime/realtime-session.service';
import { RealtimeEventsService } from '../src/modules/realtime/realtime-events.service';
import { RealtimeAccessService } from '../src/modules/realtime/realtime-access.service';
import { SecureIoAdapter } from '../src/modules/realtime/secure-io.adapter';
import { SessionRevocationModule } from '../src/security/session-revocation.module';
import { UserRepository } from '../src/modules/users/domain/repositories/user.repository';
import {
  User,
  UserProps,
} from '../src/modules/users/domain/entities/user.entity';
import { UserStatus } from '../src/modules/users/domain/entities/user-status.enum';
import { LogoutAllUseCase } from '../src/modules/auth/application/use-cases/logout-all.use-case';
import { RefreshTokenRepository } from '../src/modules/auth/domain/repositories/refresh-token.repository';
import { PrismaRlsService } from '../src/infrastructure/database/prisma/prisma-rls.service';
import { RateLimitModule } from '../src/security/rate-limit.module';

jest.mock('../src/infrastructure/database/prisma/prisma-rls.service', () => ({
  PrismaRlsService: class PrismaRlsService {},
}));

const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';
const homeA = '20000000-0000-4000-8000-000000000001';
const homeB = '20000000-0000-4000-8000-000000000002';
const familyId = '30000000-0000-4000-8000-000000000001';
const origin = 'https://app.example.test';
const secret = 'synthetic-realtime-test-secret-not-for-deployment';

function user(id: string, changes: Partial<UserProps> = {}): User {
  return new User({
    id,
    roleId: 'synthetic-role',
    roleName: 'USER',
    name: 'Synthetic',
    email: 'synthetic@example.test',
    passwordHash: 'synthetic',
    status: UserStatus.ACTIVE,
    emailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    deactivatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    sessionVersion: 0,
    ...changes,
  });
}

interface Membership {
  userId: string;
  homeId: string;
  role: string;
  status: string;
  accepted: boolean;
  ended: boolean;
  homeActive: boolean;
  homeDeleted: boolean;
}
interface MembershipQuery {
  where: {
    id_user: string;
    id_home: string;
    status: string;
    accepted_at: { not: null };
    ended_at: null;
    role: { in: string[] };
    home: { status: string; deleted_at: null };
  };
}

// Evaluate the actual Prisma filter against synthetic fixtures; no database connection.
function matches(row: Membership, query: MembershipQuery): boolean {
  const w = query.where;
  return (
    row.userId === w.id_user &&
    row.homeId === w.id_home &&
    row.status === w.status &&
    w.role.in.includes(row.role) &&
    row.accepted &&
    !row.ended &&
    row.homeActive &&
    !row.homeDeleted &&
    w.accepted_at.not === null &&
    w.ended_at === null &&
    w.home.status === 'ACTIVE' &&
    w.home.deleted_at === null
  );
}

@Module({})
class FixtureModule {}

describe('Realtime security with signed JWT and real Socket.IO clients', () => {
  let app: INestApplication<Server>;
  let jwt: JwtService;
  let url: string;
  let clients: Socket[];
  let users: Map<string, User>;
  let memberships: Membership[];
  let findById: jest.Mock;
  let findMembership: jest.Mock;
  let revokeRefresh: jest.Mock;
  let events: RealtimeEventsService;
  let sessions: RealtimeSessionService;
  let logoutAll: LogoutAllUseCase;

  beforeEach(async () => {
    clients = [];
    users = new Map([
      [userA, user(userA)],
      [userB, user(userB)],
    ]);
    memberships = [userA, userB].map((userId) => ({
      userId,
      homeId: homeA,
      role: 'MEMBER',
      status: 'ACTIVE',
      accepted: true,
      ended: false,
      homeActive: true,
      homeDeleted: false,
    }));
    findById = jest.fn((id: string) => Promise.resolve(users.get(id) ?? null));
    findMembership = jest.fn((query: MembershipQuery) =>
      Promise.resolve(
        memberships.some((row) => matches(row, query))
          ? { id_home_member: 'synthetic' }
          : null,
      ),
    );
    revokeRefresh = jest.fn().mockResolvedValue(undefined);
    const fixture = await Test.createTestingModule({
      imports: [
        FixtureModule,
        JwtModule.register({ secret }),
        SessionRevocationModule,
        RateLimitModule,
      ],
      providers: [
        RealtimeGateway,
        RealtimeSessionService,
        RealtimeAccessService,
        RealtimeEventsService,
        LogoutAllUseCase,
        {
          provide: UserRepository,
          useValue: {
            findById,
            incrementSessionVersion: (id: string) => {
              const version = users.get(id)!.sessionVersion + 1;
              users.set(id, user(id, { sessionVersion: version }));
              return Promise.resolve(version);
            },
          },
        },
        {
          provide: RefreshTokenRepository,
          useValue: {
            revokeAllByUser: revokeRefresh,
            hasActiveFamily: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: PrismaRlsService,
          useValue: {
            withUserContext: (
              _id: string,
              callback: (tx: {
                home_member: { findFirst: typeof findMembership };
              }) => Promise<boolean>,
            ) => callback({ home_member: { findFirst: findMembership } }),
          },
        },
      ],
    }).compile();
    app = fixture.createNestApplication();
    app.useWebSocketAdapter(new SecureIoAdapter(app, [origin]));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}/realtime`;
    jwt = app.get(JwtService);
    events = app.get(RealtimeEventsService);
    sessions = app.get(RealtimeSessionService);
    logoutAll = app.get(LogoutAllUseCase);
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    if (app) await app.close();
    jest.restoreAllMocks();
  });

  const token = (id = userA, overrides: Record<string, unknown> = {}) => {
    const payload: Record<string, unknown> = {
      sub: id,
      role: 'USER',
      sv: users.get(id)?.sessionVersion ?? 0,
      sid: familyId,
      exp: Math.floor(Date.now() / 1000) + 300,
      ...overrides,
    };
    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) delete payload[key];
    }
    return jwt.sign(payload);
  };

  function client(
    rawToken?: string,
    headers: Record<string, string> = { Origin: origin },
    transport = 'websocket',
  ): Socket {
    const socket = io(url, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: [transport],
      extraHeaders: headers,
      auth: rawToken === undefined ? {} : { token: rawToken },
      timeout: 2000,
    });
    clients.push(socket);
    return socket;
  }

  function waitFor<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off(event, listener);
        reject(new Error(`Missing ${event}`));
      }, 3000);
      const listener = (value: T) => {
        clearTimeout(timeout);
        resolve(value);
      };
      socket.once(event, listener);
    });
  }

  async function connect(socket: Socket): Promise<void> {
    const connected = waitFor(socket, 'realtime.connected');
    socket.connect();
    await connected;
  }

  // A later user-only event is a delivery barrier, avoiding arbitrary sleeps for negative assertions.
  async function flush(socket: Socket, userId = userA): Promise<void> {
    const done = waitFor(socket, 'notification.unread_count.updated');
    events.emitToUser(userId, 'notification.unread_count.updated', {
      unreadCount: 0,
    });
    await done;
  }

  it.each(['websocket', 'polling'])(
    'accepts an allowed browser Origin over %s',
    async (transport) => {
      const socket = client(token(), { Origin: origin }, transport);
      await connect(socket);
      expect(socket.connected).toBe(true);
    },
  );

  it.each(['websocket', 'polling'])(
    'rejects a forbidden Origin over %s before authenticating',
    async (transport) => {
      const socket = client(
        token(),
        { Origin: 'https://untrusted.example.test' },
        transport,
      );
      const rejected = waitFor(socket, 'connect_error');
      socket.connect();
      await rejected;
      expect(socket.connected).toBe(false);
      expect(findById).not.toHaveBeenCalled();
    },
  );

  it('accepts a native client without Origin using the Authorization header', async () => {
    const socket = client(undefined, { Authorization: `Bearer ${token()}` });
    await connect(socket);
    expect(socket.connected).toBe(true);
  });

  it.each([
    'missing',
    'signature',
    'expired',
    'no-exp',
    'no-version',
    'bad-sub',
    'bad-role',
    'negative-version',
  ])(
    'rejects %s JWT before completing the namespace connection',
    async (kind) => {
      const invalid =
        kind === 'missing'
          ? undefined
          : kind === 'signature'
            ? `${token()}broken`
            : token(userA, {
                ...(kind === 'expired' ? { exp: 1 } : {}),
                ...(kind === 'no-exp' ? { exp: undefined } : {}),
                ...(kind === 'no-version' ? { sv: undefined } : {}),
                ...(kind === 'bad-sub' ? { sub: 'invalid' } : {}),
                ...(kind === 'bad-role' ? { role: 'SYSTEM_ADMIN' } : {}),
                ...(kind === 'negative-version' ? { sv: -1 } : {}),
              });
      const socket = client(invalid);
      const rejected = waitFor<{ data: { code: string } }>(
        socket,
        'connect_error',
      );
      socket.connect();
      expect((await rejected).data.code).toMatch(/^REALTIME_/);
      expect(socket.connected).toBe(false);
    },
  );

  it.each([UserStatus.DEACTIVATED, UserStatus.LOCKED, UserStatus.PENDING])(
    'rejects a %s account',
    async (status) => {
      users.set(userA, user(userA, { status }));
      const socket = client(token());
      const rejected = waitFor(socket, 'connect_error');
      socket.connect();
      await rejected;
      expect(socket.connected).toBe(false);
    },
  );

  it('rejects a deleted account and a previously revoked token', async () => {
    const oldToken = token();
    users.set(userA, user(userA, { sessionVersion: 1 }));
    for (const deleted of [false, true]) {
      if (deleted) users.delete(userA);
      const socket = client(oldToken);
      const rejected = waitFor(socket, 'connect_error');
      socket.connect();
      await rejected;
      expect(socket.connected).toBe(false);
    }
  });

  it('isolates personal events and ignores client attempts to join another user room', async () => {
    const a = client(token());
    const b = client(token(userB));
    await connect(a);
    await connect(b);
    const receivedByA = jest.fn();
    a.on('notification.unread_count.updated', receivedByA);
    a.emit('join', `user:${userB}`);
    await flush(b, userB);
    await flush(a);
    expect(receivedByA).toHaveBeenCalledTimes(1);
  });

  it.each(['OWNER', 'MEMBER'])(
    'delivers household detail to an active %s',
    async (role) => {
      memberships[0].role = role;
      const socket = client(token());
      await connect(socket);
      const received = waitFor(socket, 'consumption.created');
      events.emitToUser(userA, 'consumption.created', {
        homeId: homeA,
        powerW: 45,
      });
      expect(await received).toEqual({ homeId: homeA, powerW: 45 });
    },
  );

  it.each([
    'guest',
    'pending',
    'revoked',
    'ended',
    'not-accepted',
    'other-home',
    'inactive-home',
    'deleted-home',
  ])('suppresses household detail for %s membership', async (condition) => {
    const row = memberships[0];
    if (condition === 'guest') row.role = 'GUEST';
    if (condition === 'pending') row.status = 'PENDING';
    if (condition === 'revoked') row.status = 'REVOKED';
    if (condition === 'ended') row.ended = true;
    if (condition === 'not-accepted') row.accepted = false;
    if (condition === 'other-home') row.homeId = homeB;
    if (condition === 'inactive-home') row.homeActive = false;
    if (condition === 'deleted-home') row.homeDeleted = true;
    const socket = client(token());
    await connect(socket);
    const received = jest.fn();
    socket.on('consumption.created', received);
    events.emitToUser(userA, 'consumption.created', {
      homeId: homeA,
      powerW: 45,
    });
    await flush(socket);
    expect(findMembership).toHaveBeenCalled();
    expect(received).not.toHaveBeenCalled();
  });

  it('rechecks membership after connection, including downgrade to GUEST', async () => {
    const socket = client(token());
    await connect(socket);
    const first = waitFor(socket, 'device.status.updated');
    events.emitToUser(userA, 'device.status.updated', {
      homeId: homeA,
      currentPowerW: 20,
    });
    await first;
    memberships[0].role = 'GUEST';
    const later = jest.fn();
    socket.on('device.status.updated', later);
    events.emitToUser(userA, 'device.status.updated', {
      homeId: homeA,
      currentPowerW: 21,
    });
    await flush(socket);
    expect(later).not.toHaveBeenCalled();
  });

  it('disconnects all existing user sockets on logout-all without affecting another user', async () => {
    const a1 = client(token());
    const a2 = client(token());
    const b = client(token(userB));
    await connect(a1);
    await connect(a2);
    await connect(b);
    const disconnected = [waitFor(a1, 'disconnect'), waitFor(a2, 'disconnect')];
    await logoutAll.execute(userA);
    await Promise.all(disconnected);
    expect(revokeRefresh).toHaveBeenCalledWith(userA);
    expect(sessions.hasUser(userA)).toBe(false);
    await flush(b, userB);
  });

  it('keeps sockets revoked even when refresh revocation fails after logout-all', async () => {
    const socket = client(token());
    await connect(socket);
    revokeRefresh.mockRejectedValueOnce(new Error('synthetic storage failure'));
    const disconnected = waitFor(socket, 'disconnect');
    await expect(logoutAll.execute(userA)).rejects.toThrow(
      'synthetic storage failure',
    );
    await disconnected;
    expect(sessions.hasUser(userA)).toBe(false);
  });

  it('rejects events after a session-version change even before the periodic sweep', async () => {
    const socket = client(token());
    await connect(socket);
    users.set(userA, user(userA, { sessionVersion: 1 }));
    const received = jest.fn();
    socket.on('notification.unread_count.updated', received);
    const disconnected = waitFor(socket, 'disconnect');
    events.emitToUser(userA, 'notification.unread_count.updated', {
      unreadCount: 9,
    });
    await disconnected;
    expect(received).not.toHaveBeenCalled();
  });

  it('disconnects inactive accounts on revalidation without waiting for an event', async () => {
    const socket = client(token());
    await connect(socket);
    users.set(userA, user(userA, { status: UserStatus.DEACTIVATED }));
    const disconnected = waitFor(socket, 'disconnect');
    await sessions.revalidateConnections();
    await disconnected;
  });

  it('closes an idle socket when its signed access token expires', async () => {
    const socket = client(
      token(userA, { exp: Math.floor(Date.now() / 1000) + 2 }),
    );
    await connect(socket);
    const error = waitFor<{ code: string }>(socket, 'realtime.error');
    const disconnected = waitFor(socket, 'disconnect');
    expect((await error).code).toBe('REALTIME_TOKEN_EXPIRED');
    await disconnected;
  });

  it('renews through a new authenticated connection and rejects the old revoked identity', async () => {
    const old = token();
    const socket = client(old);
    await connect(socket);
    const disconnected = waitFor(socket, 'disconnect');
    await logoutAll.execute(userA);
    await disconnected;
    const rejected = waitFor(socket, 'connect_error');
    socket.connect();
    await rejected;
    socket.auth = { token: token() };
    await connect(socket);
    await flush(socket);
    expect(socket.connected).toBe(true);
  });

  it('fails closed when account lookup is unavailable', async () => {
    const socket = client(token());
    await connect(socket);
    findById.mockRejectedValueOnce(new Error('synthetic database error'));
    const received = jest.fn();
    socket.on('notification.unread_count.updated', received);
    const disconnected = waitFor(socket, 'disconnect');
    events.emitToUser(userA, 'notification.unread_count.updated', {
      unreadCount: 1,
    });
    await disconnected;
    expect(received).not.toHaveBeenCalled();
  });

  it('suppresses household events when the membership query fails', async () => {
    const socket = client(token());
    await connect(socket);
    findMembership.mockRejectedValueOnce(
      new Error('synthetic membership failure'),
    );
    const received = jest.fn();
    socket.on('consumption.created', received);
    events.emitToUser(userA, 'consumption.created', {
      homeId: homeA,
      powerW: 20,
    });
    await flush(socket);
    expect(received).not.toHaveBeenCalled();
  });

  it('delivers a personal notification only to its declared recipient', async () => {
    const socket = client(token());
    await connect(socket);
    const received = waitFor(socket, 'notification.created');
    events.emitToUser(userA, 'notification.created', {
      userId: userA,
      homeId: null,
      deviceId: null,
    });
    expect(await received).toEqual({
      userId: userA,
      homeId: null,
      deviceId: null,
    });
    const extra = jest.fn();
    socket.on('notification.created', extra);
    events.emitToUser(userA, 'notification.created', {
      userId: userB,
      homeId: null,
      deviceId: null,
    });
    await flush(socket);
    expect(extra).not.toHaveBeenCalled();
  });

  it.each([
    ['consumption.created', { homeId: 'invalid' }],
    ['device.status.updated', {}],
    [
      'notification.created',
      { userId: userA, homeId: null, deviceId: 'synthetic-device' },
    ],
    ['unregistered.event', { homeId: homeA }],
  ])(
    'suppresses malformed or unsupported %s events',
    async (event, payload) => {
      const socket = client(token());
      await connect(socket);
      const received = jest.fn();
      socket.on(event, received);
      events.emitToUser(userA, event, payload);
      await flush(socket);
      expect(received).not.toHaveBeenCalled();
    },
  );

  it('does not let GUEST receive household notification details', async () => {
    memberships[0].role = 'GUEST';
    const socket = client(token());
    await connect(socket);
    const received = jest.fn();
    socket.on('notification.created', received);
    events.emitToUser(userA, 'notification.created', {
      userId: userA,
      homeId: homeA,
      deviceId: 'synthetic-device',
    });
    await flush(socket);
    expect(received).not.toHaveBeenCalled();
  });
});
