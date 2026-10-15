import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { PrismaRefreshTokenRepository } from '../src/modules/auth/infrastructure/persistence/prisma-refresh-token.repository';

const databaseUrl = process.env.SESSION_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const userId = '10000000-0000-4000-8000-000000000001';
const otherUser = '10000000-0000-4000-8000-000000000002';

describeDatabase(
  'Session families with actual Prisma and disposable PostgreSQL',
  () => {
    let prisma: PrismaService;
    let repository: PrismaRefreshTokenRepository;
    let pool: Pool;
    let familyId: string;

    beforeAll(async () => {
      const parsed = new URL(databaseUrl!);
      if (
        parsed.hostname !== '127.0.0.1' ||
        parsed.pathname !== '/smarthome_session_test' ||
        parsed.username !== 'session_test'
      ) {
        throw new Error(
          'Only the disposable loopback session-test database is allowed',
        );
      }
      prisma = new PrismaService(
        new ConfigService({ DATABASE_URL: databaseUrl }),
      );
      await prisma.$connect();
      pool = new Pool({ connectionString: databaseUrl });
      await prisma.$executeRaw`INSERT INTO auth."user"(id_user) VALUES (${userId}::uuid), (${otherUser}::uuid) ON CONFLICT DO NOTHING`;
      repository = new PrismaRefreshTokenRepository(prisma);
    });

    beforeEach(() => {
      familyId = randomUUID();
    });
    afterAll(async () => {
      await prisma?.$disconnect();
      await pool?.end();
    });

    const data = (tokenHash: string = randomUUID()) => ({
      userId,
      familyId,
      tokenHash,
      sessionVersion: 0,
      expiresAt: new Date(Date.now() + 300_000),
    });

    it('rotates atomically and keeps the same family active', async () => {
      const previous = await repository.create(data());
      const replacement = data();
      await expect(repository.rotate(previous.id, replacement)).resolves.toBe(
        true,
      );
      const persisted = await repository.findByHash(previous.tokenHash);
      expect(persisted?.isRevoked).toBe(true);
      expect(persisted?.replacedByTokenHash).toBe(replacement.tokenHash);
      expect(persisted?.lastUsedAt).not.toBeNull();
      await expect(
        repository.hasActiveFamily(userId, familyId, 0),
      ).resolves.toBe(true);
    });

    it('accepts only one of two concurrent rotations of the same token', async () => {
      const previous = await repository.create(data());
      const results = await Promise.all([
        repository.rotate(previous.id, data()),
        repository.rotate(previous.id, data()),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(
        await prisma.refresh_token.count({
          where: { family_id: familyId, revoked_at: null },
        }),
      ).toBe(1);
    });

    async function waitForBlocked(count: number): Promise<void> {
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) {
        const result = await pool.query<{ count: string }>(
          "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
        );
        if (+result.rows[0].count >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Expected advisory lock contention was not observed');
    }

    it.each(['logout-first', 'rotation-first'])(
      'does not resurrect a family with overlapping %s operations',
      async (order) => {
        const previous = await repository.create(data());
        const blocker: PoolClient = await pool.connect();
        let first: Promise<unknown> | undefined;
        let second: Promise<unknown> | undefined;
        try {
          await blocker.query('BEGIN');
          await blocker.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
            [familyId],
          );
          first =
            order === 'logout-first'
              ? repository.revokeFamily(familyId)
              : repository.rotate(previous.id, data());
          // Attach a handler immediately, even if the contention assertion later fails.
          void first.catch(() => undefined);
          await waitForBlocked(1);
          second =
            order === 'logout-first'
              ? repository.rotate(previous.id, data())
              : repository.revokeFamily(familyId);
          void second.catch(() => undefined);
          await waitForBlocked(2);
          await blocker.query('COMMIT');
          const results = await Promise.all([first, second]);
          if (order === 'logout-first') expect(results[1]).toBe(false);
          else expect(results[0]).toBe(true);
          await expect(
            repository.hasActiveFamily(userId, familyId, 0),
          ).resolves.toBe(false);
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          await Promise.allSettled([first, second]);
        }
      },
    );

    it('rolls back rotation completely if inserting the successor fails', async () => {
      const previous = await repository.create(data());
      const duplicate = await repository.create({
        ...data(),
        familyId: randomUUID(),
      });
      await expect(
        repository.rotate(previous.id, data(duplicate.tokenHash)),
      ).rejects.toThrow();
      expect((await repository.findByHash(previous.tokenHash))?.isRevoked).toBe(
        false,
      );
      expect(
        await prisma.refresh_token.count({ where: { family_id: familyId } }),
      ).toBe(1);
    });

    it('rejects expired, revoked and mismatched predecessors', async () => {
      const previous = await repository.create(data());
      await expect(
        repository.rotate(previous.id, { ...data(), userId: otherUser }),
      ).resolves.toBe(false);
      await expect(
        repository.rotate(previous.id, { ...data(), sessionVersion: 1 }),
      ).resolves.toBe(false);
      await expect(
        repository.rotate(previous.id, { ...data(), familyId: randomUUID() }),
      ).resolves.toBe(false);
      await prisma.refresh_token.update({
        where: { id_refresh_token: previous.id },
        data: { expires_at: new Date(0) },
      });
      await expect(repository.rotate(previous.id, data())).resolves.toBe(false);
      await repository.revokeFamily(familyId);
      await expect(repository.rotate(previous.id, data())).resolves.toBe(false);
    });

    it('binds active families to user and session version and denies expired families', async () => {
      await repository.create(data());
      await expect(
        repository.hasActiveFamily(otherUser, familyId, 0),
      ).resolves.toBe(false);
      await expect(
        repository.hasActiveFamily(userId, familyId, 1),
      ).resolves.toBe(false);
      await prisma.refresh_token.updateMany({
        where: { family_id: familyId },
        data: { expires_at: new Date(0) },
      });
      await expect(
        repository.hasActiveFamily(userId, familyId, 0),
      ).resolves.toBe(false);
    });

    it('revokes the family idempotently while leaving another family active', async () => {
      await repository.create(data());
      const another = randomUUID();
      await repository.create({ ...data(), familyId: another });
      await repository.revokeFamily(familyId);
      await repository.revokeFamily(familyId);
      await expect(
        repository.hasActiveFamily(userId, familyId, 0),
      ).resolves.toBe(false);
      await expect(
        repository.hasActiveFamily(userId, another, 0),
      ).resolves.toBe(true);
    });
  },
);
