import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import type { MqttPreparationSecretPort } from '../../application/services/shelly-mqtt-preparation.coordinator';

/**
 * Envelope persisted by a later PostgreSQL/Vault implementation.
 * It must NOT be stored together with the key or sent to HTTP endpoints.
 * Every base64url field is encoded without padding.
 */
export interface EncryptedMqttPreparationSecretRecord {
  readonly operationId: string;
  readonly formatVersion: 1;
  readonly keyId: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authTag: string;
}

/**
 * The concrete repository must enforce UNIQUE(operationId), durability and
 * minimum permissions. insertIfAbsent must be atomic and must not overwrite.
 * This interface does NOT enable its use with volatile storage in production.
 */
export interface MqttPreparationSecretRepository {
  load(operationId: string, leaseToken: string): Promise<EncryptedMqttPreparationSecretRecord | null>;
  insertIfAbsent(record: EncryptedMqttPreparationSecretRecord, leaseToken: string): Promise<boolean>;
}

export interface MqttSecretEncryptionKey {
  readonly id: string;
  /** 32-byte AES-256 key, obtained from KMS/Vault or a secrets manager. */
  readonly material: Buffer;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const ENCODING = /^[A-Za-z0-9_-]+$/;
const VERSION = 1 as const;
const KEY_DOMAIN = 'smarthome:mqtt:preparation-password:v1';

function decodeCanonical(value: unknown, length?: number): Buffer {
  if (typeof value !== 'string' || !ENCODING.test(value) || value.length > 4096) {
    throw new Error('BAD_BASE64URL');
  }
  const data = Buffer.from(value, 'base64url');
  if (data.toString('base64url') !== value || (length !== undefined && data.length !== length)) {
    throw new Error('BAD_BASE64URL');
  }
  return data;
}

function aad(operationId: string, keyId: string): Buffer {
  return Buffer.from(`${KEY_DOMAIN}:${keyId}:${operationId}`, 'utf8');
}

/**
 * Cryptographic engine: creates no tables, does not connect to SQL and does not enable pairing.
 * Real durability depends on MqttPreparationSecretRepository.
 */
export class EncryptedMqttPreparationSecretPort implements MqttPreparationSecretPort {
  private readonly key: Buffer;
  private readonly keyId: string;

  constructor(
    private readonly repository: MqttPreparationSecretRepository,
    encryptionKey: MqttSecretEncryptionKey,
  ) {
    if (!encryptionKey || !KEY_ID.test(encryptionKey.id) ||
        !Buffer.isBuffer(encryptionKey.material) || encryptionKey.material.length !== 32) {
      throw new Error('MQTT_PREPARATION_SECRET_KEY_INVALID');
    }
    // Private copy: mutating the caller's Buffer does not change the active key.
    this.key = Buffer.from(encryptionKey.material);
    this.keyId = encryptionKey.id;
  }

  private encrypt(operationId: string, password: string): EncryptedMqttPreparationSecretRecord {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(aad(operationId, this.keyId));
    const ciphertext = Buffer.concat([
      cipher.update(password, 'utf8'),
      cipher.final(),
    ]);
    return {
      operationId,
      formatVersion: VERSION,
      keyId: this.keyId,
      nonce: nonce.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      authTag: cipher.getAuthTag().toString('base64url'),
    };
  }

  private decrypt(operationId: string, record: EncryptedMqttPreparationSecretRecord): string {
    if (!record || record.operationId !== operationId ||
        record.formatVersion !== VERSION || record.keyId !== this.keyId) {
      throw new Error('BAD_ENVELOPE');
    }
    const nonce = decodeCanonical(record.nonce, 12);
    const tag = decodeCanonical(record.authTag, 16);
    const payload = decodeCanonical(record.ciphertext);
    if (payload.length !== 43) throw new Error('BAD_ENVELOPE');
    const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAAD(aad(operationId, this.keyId));
    decipher.setAuthTag(tag);
    const password = Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
    if (!/^[A-Za-z0-9_-]{43}$/.test(password)) throw new Error('BAD_ENVELOPE');
    return password;
  }

  async issueOrLoadForOperation(operationId: string, leaseToken: string): Promise<string> {
    if (typeof operationId !== 'string' || !UUID.test(operationId)) {
      throw new Error('MQTT_PREPARATION_SECRET_OPERATION_INVALID');
    }
    // Prevent reads and inserts without a fenced lease of the operation.
    // The real authority is validated again in PostgreSQL under a row lock.
    if (typeof leaseToken !== 'string' || !UUID.test(leaseToken)) {
      throw new Error('MQTT_PREPARATION_SECRET_LEASE_INVALID');
    }
    try {
      const existing = await this.repository.load(operationId, leaseToken);
      if (existing !== null) return this.decrypt(operationId, existing);

      const generated = randomBytes(32).toString('base64url');
      const candidate = this.encrypt(operationId, generated);
      const inserted = await this.repository.insertIfAbsent(candidate, leaseToken);
      if (typeof inserted !== 'boolean') throw new Error('BAD_REPOSITORY_REPLY');

      // Authoritative read even after INSERT: detects a loss of durability.
      const stored = await this.repository.load(operationId, leaseToken);
      if (!stored) throw new Error('MISSING_AFTER_INSERT');
      const persistedPassword = this.decrypt(operationId, stored);
      if (inserted && persistedPassword !== generated) throw new Error('INSERT_MISMATCH');
      return persistedPassword;
    } catch {
      // Never propagate SQL, ciphertext, keyIds or internal messages to the caller.
      // An INSERT with an uncertain result must be recovered through a later
      // re-read: absence is not assumed and there is no blind retry.
      throw new Error('MQTT_PREPARATION_SECRET_UNAVAILABLE');
    }
  }
}
