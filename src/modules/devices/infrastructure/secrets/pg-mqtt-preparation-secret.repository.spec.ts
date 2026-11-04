import {
  PgMqttPreparationSecretRepository,
  type MqttSecretSqlQueryPort,
} from './pg-mqtt-preparation-secret.repository';
import type { EncryptedMqttPreparationSecretRecord } from './encrypted-mqtt-preparation-secret.port';

const operationId = 'b42777a2-b12b-459c-9270-74a0d9d9f4b2';
const otherId = '8909e7cd-f1ef-4b6b-90bb-c94ec6c484b0';
const lease = '783124c6-1040-4866-899f-dd65a1b2a99b';
const record: EncryptedMqttPreparationSecretRecord = {
  operationId,
  formatVersion: 1,
  keyId: 'lab-key-v1',
  nonce: 'A'.repeat(16),
  ciphertext: 'B'.repeat(58),
  authTag: 'C'.repeat(22),
};
const sqlRow = {
  operation_id: operationId,
  format_version: 1,
  key_id: record.keyId,
  nonce: record.nonce,
  ciphertext: record.ciphertext,
  auth_tag: record.authTag,
};

function harness(rows: unknown[]) {
  const query = jest.fn().mockResolvedValue({ rows });
  const db: MqttSecretSqlQueryPort = { query };
  return { repository: new PgMqttPreparationSecretRepository(db), query };
}

describe('PgMqttPreparationSecretRepository - SQL 028 proposed', () => {
  it('rejects a missing query client', () => {
    expect(() => new PgMqttPreparationSecretRepository(null as never))
      .toThrow('MQTT_SECRET_SQL_CLIENT_INVALID');
  });
  it('queries solely a parameterized SECURITY DEFINER load function', async () => {
    const { repository, query } = harness([sqlRow]);
    expect(await repository.load(operationId, lease)).toEqual(record);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('devices.fn_load_mqtt_preparation_secret($1::uuid, $2::uuid)'), [operationId, lease]);
    const sql = (query.mock.calls as unknown[][])[0][0];
    expect(sql).not.toMatch(/\bFROM\s+devices\.mqtt_preparation_secret\b/i);
  });
  it('returns null on zero rows', async () => {
    expect(await harness([]).repository.load(operationId, lease)).toBeNull();
  });
  it('uses a parameterized insert function, never direct table insert', async () => {
    const { repository, query } = harness([{ inserted: true }]);
    expect(await repository.insertIfAbsent(record, lease)).toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('devices.fn_insert_mqtt_preparation_secret_if_absent'),
      [operationId, lease, 1, 'lab-key-v1', record.nonce, record.ciphertext, record.authTag]);
    const sql = (query.mock.calls as unknown[][])[0][0];
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
  });
  it('returns false for duplicate when SQL says no insertion', async () => {
    expect(await harness([{ inserted: false }]).repository.insertIfAbsent(record, lease)).toBe(false);
  });
  it('rejects malformed operationId before SQL', async () => {
    const { repository, query } = harness([]);
    for (const bad of ['', 'abc', operationId.toUpperCase(), "' OR TRUE --"]) {
      await expect(repository.load(bad, lease)).rejects.toThrow('MQTT_SECRET_OPERATION_INVALID');
    }
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects bad fencing tokens before any SQL query', async () => {
    const { repository, query } = harness([]);
    for (const bad of ['', 'fake', lease.toUpperCase()]) {
      await expect(repository.load(operationId, bad)).rejects.toThrow('MQTT_SECRET_LEASE_INVALID');
      await expect(repository.insertIfAbsent(record, bad)).rejects.toThrow('MQTT_SECRET_LEASE_INVALID');
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects malformed encryption envelopes before SQL', async () => {
    const { repository, query } = harness([{ inserted: true }]);
    for (const change of [{ keyId: 'bad key' }, { nonce: 'short' }, { authTag: '' },
      { ciphertext: 'plain' }, { formatVersion: 2 }, { operationId: otherId.toUpperCase() }]) {
      await expect(repository.insertIfAbsent({ ...record, ...change } as never, lease))
        .rejects.toThrow('MQTT_SECRET_RECORD_INVALID');
    }
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects a loaded envelope with the wrong operationId', async () => {
    await expect(harness([{ ...sqlRow, operation_id: otherId }]).repository.load(operationId, lease))
      .rejects.toThrow('MQTT_SECRET_SQL_REPLY_INVALID');
  });
  it('fails closed if load responds with duplicate rows', async () => {
    await expect(harness([sqlRow, sqlRow]).repository.load(operationId, lease))
      .rejects.toThrow('MQTT_SECRET_SQL_REPLY_INVALID');
  });
  it('fails closed on malformed loaded fields', async () => {
    await expect(harness([{ ...sqlRow, format_version: '1' }]).repository.load(operationId, lease))
      .rejects.toThrow('MQTT_SECRET_SQL_REPLY_INVALID');
  });
  it('fails closed on unexpected insert response types or row count', async () => {
    for (const rows of [[], [{ inserted: 'true' }], [{ inserted: true }, { inserted: false }]]) {
      await expect(harness(rows).repository.insertIfAbsent(record, lease))
        .rejects.toThrow('MQTT_SECRET_SQL_REPLY_INVALID');
    }
  });
  it('propagates DB failure so the AES-GCM engine can fail closed', async () => {
    const query = jest.fn().mockRejectedValue(new Error('database offline'));
    const repo = new PgMqttPreparationSecretRepository({ query });
    await expect(repo.load(operationId, lease)).rejects.toThrow('database offline');
    await expect(repo.insertIfAbsent(record, lease)).rejects.toThrow('database offline');
  });
});
