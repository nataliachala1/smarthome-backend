import { randomBytes } from 'node:crypto';
import {
  EncryptedMqttPreparationSecretPort,
  type EncryptedMqttPreparationSecretRecord,
  type MqttPreparationSecretRepository,
} from './encrypted-mqtt-preparation-secret.port';

const A = 'b42777a2-b12b-459c-9270-74a0d9d9f4b2';
const B = '8909e7cd-f1ef-4b6b-90bb-c94ec6c484b0';
const key = randomBytes(32);
const lease = '783124c6-1040-4866-899f-dd65a1b2a99b';

class MemoryRepository implements MqttPreparationSecretRepository {
  readonly stored = new Map<string, EncryptedMqttPreparationSecretRecord>();
  load(operationId: string) { return Promise.resolve(this.stored.get(operationId) ?? null); }
  insertIfAbsent(record: EncryptedMqttPreparationSecretRecord) {
    if (this.stored.has(record.operationId)) return Promise.resolve(false);
    this.stored.set(record.operationId, record);
    return Promise.resolve(true);
  }
}

function make(repo: MqttPreparationSecretRepository, material = key, id = 'lab-50326-v1') {
  return new EncryptedMqttPreparationSecretPort(repo, { id, material });
}

describe('EncryptedMqttPreparationSecretPort - cryptographic engine only', () => {
  it('issues 256-bit URL safe secret and never stores its plaintext', async () => {
    const repo = new MemoryRepository();
    const secret = await make(repo).issueOrLoadForOperation(A, lease);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify([...repo.stored.values()])).not.toContain(secret);
    expect(repo.stored.get(A)?.formatVersion).toBe(1);
  });

  it('returns same secret after repeating an operation and across new instances', async () => {
    const repo = new MemoryRepository();
    const original = await make(repo).issueOrLoadForOperation(A, lease);
    expect(await make(repo).issueOrLoadForOperation(A, lease)).toBe(original);
    expect(repo.stored.size).toBe(1);
  });

  it('never reuses secrets for distinct operation ids', async () => {
    const repo = new MemoryRepository();
    const port = make(repo);
    expect(await port.issueOrLoadForOperation(A, lease)).not.toBe(await port.issueOrLoadForOperation(B, lease));
  });

  it('resolves simultaneous calls to the same stored secret', async () => {
    const repo = new MemoryRepository();
    const got = await Promise.all(Array.from({ length: 25 }, () =>
      make(repo).issueOrLoadForOperation(A, lease)));
    expect(new Set(got).size).toBe(1);
    expect(repo.stored.size).toBe(1);
  });

  it('rejects bad operationId before touching repository', async () => {
    const load = jest.fn();
    const insertIfAbsent = jest.fn();
    const port = make({ load, insertIfAbsent });
    for (const id of ['', 'wrong', '../../etc/passwd', A.toUpperCase()]) {
      await expect(port.issueOrLoadForOperation(id, lease)).rejects.toThrow('MQTT_PREPARATION_SECRET_OPERATION_INVALID');
    }
    expect(load).not.toHaveBeenCalled();
    expect(insertIfAbsent).not.toHaveBeenCalled();
  });

  it('requires a valid lease token and does not query repository otherwise', async () => {
    const load = jest.fn();
    const insertIfAbsent = jest.fn();
    const port = make({ load, insertIfAbsent });
    for (const staleOrBad of ['', 'not-a-uuid', lease.toUpperCase()]) {
      await expect(port.issueOrLoadForOperation(A, staleOrBad))
        .rejects.toThrow('MQTT_PREPARATION_SECRET_LEASE_INVALID');
    }
    expect(load).not.toHaveBeenCalled();
    expect(insertIfAbsent).not.toHaveBeenCalled();
  });

  it('propagates the same fencing token to all SQL operations', async () => {
    const repo = new MemoryRepository();
    const load = jest.spyOn(repo, 'load');
    const insertIfAbsent = jest.spyOn(repo, 'insertIfAbsent');
    await make(repo).issueOrLoadForOperation(A, lease);
    expect(load).toHaveBeenNthCalledWith(1, A, lease);
    expect(load).toHaveBeenNthCalledWith(2, A, lease);
    expect(insertIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ operationId: A }), lease);
  });

  it('rejects invalid AES key lengths and keyId', () => {
    const repo = new MemoryRepository();
    expect(() => make(repo, Buffer.alloc(16))).toThrow('MQTT_PREPARATION_SECRET_KEY_INVALID');
    expect(() => make(repo, key, 'bad name')).toThrow('MQTT_PREPARATION_SECRET_KEY_INVALID');
  });

  it('copies the encryption key to prevent caller mutation', async () => {
    const repo = new MemoryRepository();
    const mutableKey = Buffer.from(key);
    const port = make(repo, mutableKey);
    const secret = await port.issueOrLoadForOperation(A, lease);
    mutableKey.fill(0);
    expect(await port.issueOrLoadForOperation(A, lease)).toBe(secret);
  });

  it('fails closed on wrong key ID after restart', async () => {
    const repo = new MemoryRepository();
    await make(repo).issueOrLoadForOperation(A, lease);
    await expect(make(repo, key, 'rotated').issueOrLoadForOperation(A, lease))
      .rejects.toThrow('MQTT_PREPARATION_SECRET_UNAVAILABLE');
  });

  it('fails closed on wrong key material even with matching key ID', async () => {
    const repo = new MemoryRepository();
    await make(repo).issueOrLoadForOperation(A, lease);
    await expect(make(repo, randomBytes(32)).issueOrLoadForOperation(A, lease))
      .rejects.toThrow('MQTT_PREPARATION_SECRET_UNAVAILABLE');
  });

  it('rejects modification of authentication tag, nonce and ciphertext', async () => {
    for (const field of ['authTag', 'nonce', 'ciphertext'] as const) {
      const repo = new MemoryRepository();
      await make(repo).issueOrLoadForOperation(A, lease);
      const prior = repo.stored.get(A)!;
      const altered = (field === 'authTag' ? 'A'.repeat(prior[field].length) : 'B'.repeat(prior[field].length));
      repo.stored.set(A, { ...prior, [field]: altered });
      await expect(make(repo).issueOrLoadForOperation(A, lease))
        .rejects.toThrow('MQTT_PREPARATION_SECRET_UNAVAILABLE');
    }
  });

  it('prevents ciphertext swapping across operation ids (AAD binding)', async () => {
    const repo = new MemoryRepository();
    const port = make(repo);
    await port.issueOrLoadForOperation(A, lease);
    await port.issueOrLoadForOperation(B, lease);
    const first = repo.stored.get(A)!;
    const second = repo.stored.get(B)!;
    repo.stored.set(A, { ...second, operationId: A });
    repo.stored.set(B, { ...first, operationId: B });
    await expect(port.issueOrLoadForOperation(A, lease)).rejects.toThrow('MQTT_PREPARATION_SECRET_UNAVAILABLE');
    await expect(port.issueOrLoadForOperation(B, lease)).rejects.toThrow('MQTT_PREPARATION_SECRET_UNAVAILABLE');
  });

  it('fails closed when insert claims success but the stored row is missing', async () => {
    const port = make({ load: () => Promise.resolve(null), insertIfAbsent: () => Promise.resolve(true) });
    await expect(port.issueOrLoadForOperation(A, lease)).rejects.toThrow('MQTT_PREPARATION_SECRET_UNAVAILABLE');
  });

  it('does not retry automatically after an uncertain INSERT', async () => {
    const insertIfAbsent = jest.fn().mockRejectedValue(new Error('sensitive SQL text'));
    const port = make({ load: () => Promise.resolve(null), insertIfAbsent });
    await expect(port.issueOrLoadForOperation(A, lease)).rejects.toThrow('MQTT_PREPARATION_SECRET_UNAVAILABLE');
    expect(insertIfAbsent).toHaveBeenCalledTimes(1);
  });

  it('denies malformed or unexpected repository answers', async () => {
    const port = make({ load: () => Promise.resolve(null), insertIfAbsent: () => Promise.resolve('yes' as never) });
    await expect(port.issueOrLoadForOperation(A, lease)).rejects.toThrow('MQTT_PREPARATION_SECRET_UNAVAILABLE');
  });

  it('requires the repository to keep a single authoritative record on race', async () => {
    const repo = new MemoryRepository();
    const original = await make(repo).issueOrLoadForOperation(A, lease);
    const racingRepo: MqttPreparationSecretRepository = {
      load: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(repo.stored.get(A)),
      insertIfAbsent: jest.fn().mockResolvedValue(false),
    };
    expect(await make(racingRepo).issueOrLoadForOperation(A, lease)).toBe(original);
  });
});
