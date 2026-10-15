import { JwtService } from '@nestjs/jwt';
import {
  RealtimeSessionService,
  RealtimeSocket,
} from '../src/modules/realtime/realtime-session.service';
import { SessionRevocationService } from '../src/security/session-revocation.module';
import { UserRepository } from '../src/modules/users/domain/repositories/user.repository';
import { User } from '../src/modules/users/domain/entities/user.entity';
import { UserStatus } from '../src/modules/users/domain/entities/user-status.enum';

const userId = '10000000-0000-4000-8000-000000000001';

describe('Realtime authorization concurrency (isolated)', () => {
  let service: RealtimeSessionService;
  let revocations: SessionRevocationService;
  let findById: jest.Mock;
  const snapshot = {
    status: UserStatus.ACTIVE,
    sessionVersion: 0,
    roleName: 'USER',
  } as User;

  function socket(id = 'synthetic'): RealtimeSocket {
    const candidate = {
      id,
      connected: true,
      data: {
        identity: {
          userId,
          role: 'USER',
          sessionVersion: 0,
          expiresAt: Date.now() + 300_000,
        },
      },
      emit: jest.fn(),
      disconnect: jest.fn(() => {
        candidate.connected = false;
      }),
    };
    return candidate as unknown as RealtimeSocket;
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  beforeEach(() => {
    findById = jest.fn().mockResolvedValue(snapshot);
    revocations = new SessionRevocationService();
    service = new RealtimeSessionService(
      new JwtService({ secret: 'synthetic' }),
      { findById } as unknown as UserRepository,
      revocations,
    );
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('does not resurrect a connection revoked while its initial lookup was pending', async () => {
    const pending = deferred<User>();
    findById.mockReturnValueOnce(pending.promise);
    const client = socket();
    const registering = service.register(client);
    revocations.revokeOlderSessions(userId, 1);
    pending.resolve(snapshot);
    await expect(registering).resolves.toBe(false);
    expect(client.connected).toBe(false);
    expect(service.hasUser(userId)).toBe(false);
  });

  it('does not return a socket revoked while an outgoing event lookup was pending', async () => {
    const client = socket();
    await service.register(client);
    const pending = deferred<User>();
    findById.mockReturnValueOnce(pending.promise);
    const authorized = service.authorizedSockets(userId);
    revocations.revokeOlderSessions(userId, 1);
    pending.resolve(snapshot);
    await expect(authorized).resolves.toEqual([]);
  });

  it('does not return a socket disconnected while its lookup was pending', async () => {
    const client = socket();
    await service.register(client);
    const pending = deferred<User>();
    findById.mockReturnValueOnce(pending.promise);
    const authorized = service.authorizedSockets(userId);
    client.disconnect(true);
    service.remove(client);
    pending.resolve(snapshot);
    await expect(authorized).resolves.toEqual([]);
  });

  it('does not revoke a new session for a delayed notification of an older version', async () => {
    const client = socket();
    client.data.identity!.sessionVersion = 2;
    findById.mockResolvedValue({ ...snapshot, sessionVersion: 2 });
    await service.register(client);
    revocations.revokeOlderSessions(userId, 1);
    await expect(service.authorizedSockets(userId)).resolves.toEqual([client]);
  });

  it('rechecks expiry after a slow account lookup', async () => {
    const client = socket();
    await service.register(client);
    const pending = deferred<User>();
    findById.mockReturnValueOnce(pending.promise);
    const authorized = service.authorizedSockets(userId);
    jest.spyOn(Date, 'now').mockReturnValue(client.data.identity!.expiresAt);
    pending.resolve(snapshot);
    await expect(authorized).resolves.toEqual([]);
    expect(client.connected).toBe(false);
  });
});
