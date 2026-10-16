import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '../../../../../generated/prisma/client';
import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

const SESSION_TTL_MS = 10 * 60 * 1000;
const ACTIVE_STATES = [
  'PENDING',
  'DEVICE_IDENTIFIED',
  'WAITING_FOR_MQTT',
  'CONNECTED',
];
const SUPPORTED_MODEL = 'S4SW-001P16EU';

type PairingRow = {
  id_device_pairing_session: string;
  id_home: string;
  method: 'AP' | 'BLE';
  status: string;
  manufacturer_device_id: string | null;
  model_code: string | null;
  firmware_version: string | null;
  identity_reported_at: Date | null;
  expires_at: Date;
  completed_device_id: string | null;
  failure_code: string | null;
  created_at: Date;
  token_hash: string;
};

@Injectable()
export class ShellyPairingSessionService {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  async assertCanManageHome(userId: string, homeId: string): Promise<void> {
    await this.prismaRls.withUserContext(userId, async (tx) => {
      const [access] = await tx.$queryRaw<{ allowed: boolean }[]>`
        SELECT homes.fn_can_manage_home(${homeId}::uuid) AS allowed
      `;
      if (!access?.allowed) {
        throw new ForbiddenException({
          code: 'HOME_OWNER_REQUIRED',
          message: 'Solo OWNER puede vincular dispositivos Shelly.',
        });
      }
    });
  }

  async create(
    userId: string,
    homeId: string,
    input: { requestId: string; sessionToken: string; method: 'AP' | 'BLE' },
  ) {
    if (input.method === 'BLE') {
      throw new UnprocessableEntityException({
        code: 'PAIRING_METHOD_NOT_AVAILABLE',
        message: 'BLE automatizado sigue pendiente de una POC nativa validada.',
      });
    }

    const requestHash = this.sha256(input.requestId);
    const tokenHash = this.sha256(input.sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    return this.prismaRls.withUserContext(userId, async (tx) => {
      let inserted: PairingRow[];
      try {
        inserted = await tx.$queryRaw<PairingRow[]>`
          INSERT INTO devices.device_pairing_session (
            id_home, id_user, request_key_hash, token_hash, method, expires_at
          )
          SELECT ${homeId}::uuid, ${userId}::uuid, ${requestHash}, ${tokenHash}, 'AP', ${expiresAt}
          WHERE homes.fn_can_manage_home(${homeId}::uuid)
          ON CONFLICT (id_home, id_user, request_key_hash) DO NOTHING
          RETURNING id_device_pairing_session, id_home, method, status,
            manufacturer_device_id, model_code, firmware_version, identity_reported_at,
            expires_at, completed_device_id, failure_code, created_at, token_hash
        `;
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          throw new ConflictException({
            code: 'PAIRING_TOKEN_REUSED',
            message: 'El token de sesión ya fue utilizado.',
          });
        }
        throw error;
      }

      let row = inserted[0];
      if (!row) {
        const existing = await tx.$queryRaw<PairingRow[]>`
          SELECT id_device_pairing_session, id_home, method, status,
            manufacturer_device_id, model_code, firmware_version, identity_reported_at,
            expires_at, completed_device_id, failure_code, created_at, token_hash
          FROM devices.device_pairing_session
          WHERE id_home = ${homeId}::uuid AND id_user = ${userId}::uuid
            AND request_key_hash = ${requestHash}
          LIMIT 1
        `;
        row = existing[0];
        if (!row) {
          throw new ForbiddenException({
            code: 'HOME_OWNER_REQUIRED',
            message: 'Solo OWNER puede iniciar pairing.',
          });
        }
        if (!this.constantTimeEqual(row.token_hash, tokenHash)) {
          throw new ConflictException({
            code: 'PAIRING_IDEMPOTENCY_KEY_REUSED',
            message: 'El requestId ya se usó con otro token.',
          });
        }
      }

      return this.toResponse(row);
    });
  }

  async get(
    userId: string,
    homeId: string,
    sessionId: string,
    sessionToken: string,
  ) {
    return this.prismaRls.withUserContext(userId, async (tx) => {
      const row = await this.loadAndAuthorize(
        tx,
        homeId,
        sessionId,
        sessionToken,
      );
      await this.expireIfNeeded(tx, row);
      const refreshed = await this.loadAndAuthorize(
        tx,
        homeId,
        sessionId,
        sessionToken,
      );
      return this.toResponse(refreshed);
    });
  }

  async reportIdentity(
    userId: string,
    homeId: string,
    sessionId: string,
    sessionToken: string,
    input: {
      manufacturerDeviceId: string;
      modelCode: string;
      firmwareVersion?: string;
      generation: number;
    },
  ) {
    if (input.modelCode !== SUPPORTED_MODEL || input.generation !== 4) {
      throw new UnprocessableEntityException({
        code: 'PAIRING_MODEL_UNSUPPORTED',
        message: 'El modelo reportado no es compatible con Shelly 1PM Gen4.',
      });
    }
    const manufacturerDeviceId = input.manufacturerDeviceId
      .trim()
      .toLowerCase();

    return this.prismaRls.withUserContext(userId, async (tx) => {
      const row = await this.loadAndAuthorize(
        tx,
        homeId,
        sessionId,
        sessionToken,
      );
      await this.expireIfNeeded(tx, row);
      if (row.expires_at.getTime() <= Date.now()) {
        throw new GoneException({
          code: 'PAIRING_SESSION_EXPIRED',
          message: 'La sesión de pairing expiró.',
        });
      }
      if (row.status === 'DEVICE_IDENTIFIED') {
        const same =
          row.manufacturer_device_id === manufacturerDeviceId &&
          row.model_code === input.modelCode &&
          row.firmware_version === (input.firmwareVersion ?? null);
        if (!same) {
          throw new ConflictException({
            code: 'PAIRING_IDENTITY_ALREADY_REPORTED',
            message: 'La sesión ya contiene otra identidad reportada.',
          });
        }
        return this.toResponse(row);
      }
      if (row.status !== 'PENDING') {
        throw new ConflictException({
          code: 'PAIRING_SESSION_NOT_IDENTIFIABLE',
          message: 'La sesión no admite identificación en su estado actual.',
        });
      }

      const [claim] = await tx.$queryRaw<{ claimed: boolean }[]>`
        SELECT devices.fn_claim_pairing_identity(
          ${sessionId}::uuid, ${manufacturerDeviceId},
          ${input.modelCode}, ${input.firmwareVersion ?? null}
        ) AS claimed
      `;
      if (!claim?.claimed) {
        const current = await this.loadAndAuthorize(
          tx,
          homeId,
          sessionId,
          sessionToken,
        );
        if (current.expires_at.getTime() <= Date.now()) {
          await this.expireIfNeeded(tx, current);
          throw new GoneException({
            code: 'PAIRING_SESSION_EXPIRED',
            message: 'La sesión de pairing expiró.',
          });
        }
        if (current.status !== 'PENDING') {
          throw new ConflictException({
            code: 'PAIRING_SESSION_STATE_CHANGED',
            message:
              'La sesión cambió; consulta su estado e intenta de nuevo si sigue pendiente.',
          });
        }
        throw new ConflictException({
          code: 'PAIRING_DEVICE_ALREADY_REGISTERED',
          message: 'Este Shelly ya está vinculado o en otra sesión activa.',
        });
      }
      const updated = await this.loadAndAuthorize(
        tx,
        homeId,
        sessionId,
        sessionToken,
      );
      if (updated.status !== 'DEVICE_IDENTIFIED') {
        throw new ConflictException({
          code: 'PAIRING_SESSION_STATE_CHANGED',
          message:
            'La sesión cambió; consulta su estado e intenta de nuevo si sigue pendiente.',
        });
      }
      return this.toResponse(updated);
    });
  }

  async cancel(
    userId: string,
    homeId: string,
    sessionId: string,
    sessionToken: string,
  ) {
    return this.prismaRls.withUserContext(userId, async (tx) => {
      const row = await this.loadAndAuthorize(
        tx,
        homeId,
        sessionId,
        sessionToken,
      );
      await this.expireIfNeeded(tx, row);
      const current = await this.loadAndAuthorize(
        tx,
        homeId,
        sessionId,
        sessionToken,
      );
      if (current.status === 'COMPLETED') {
        throw new ConflictException({
          code: 'PAIRING_ALREADY_COMPLETED',
          message: 'Una sesión completada no se puede cancelar.',
        });
      }
      if (
        current.status === 'CANCELLED' ||
        current.status === 'EXPIRED' ||
        current.status === 'FAILED'
      ) {
        return this.toResponse(current);
      }
      const updated = await tx.$queryRaw<PairingRow[]>`
        UPDATE devices.device_pairing_session
        SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP,
            manufacturer_device_id = NULL, model_code = NULL,
            firmware_version = NULL, identity_reported_at = NULL
        WHERE id_device_pairing_session = ${sessionId}::uuid
          AND id_home = ${homeId}::uuid AND id_user = ${userId}::uuid
          AND status = ANY(${ACTIVE_STATES}::text[])
        RETURNING id_device_pairing_session, id_home, method, status,
          manufacturer_device_id, model_code, firmware_version, identity_reported_at,
          expires_at, completed_device_id, failure_code, created_at, token_hash
      `;
      return this.toResponse(updated[0] ?? current);
    });
  }

  async complete(
    userId: string,
    homeId: string,
    sessionId: string,
    sessionToken: string,
    name: string,
  ) {
    return this.prismaRls.withUserContext(userId, async (tx) => {
      const row = await this.loadAndAuthorize(
        tx,
        homeId,
        sessionId,
        sessionToken,
      );
      await this.expireIfNeeded(tx, row);
      const current = await this.loadAndAuthorize(
        tx,
        homeId,
        sessionId,
        sessionToken,
      );

      if (current.status === 'COMPLETED') {
        return {
          ...this.toResponse(current),
          completion: {
            ready: true,
            deviceId: current.completed_device_id,
          },
        };
      }

      if (current.expires_at.getTime() <= Date.now()) {
        throw new GoneException({
          code: 'PAIRING_SESSION_EXPIRED',
          message: 'La sesión de pairing expiró.',
        });
      }
      if (current.status === 'DEVICE_IDENTIFIED') {
        await tx.$executeRaw`
          UPDATE devices.device_pairing_session
          SET status = 'WAITING_FOR_MQTT'
          WHERE id_device_pairing_session = ${sessionId}::uuid
            AND id_home = ${homeId}::uuid
            AND id_user = ${userId}::uuid
            AND status = 'DEVICE_IDENTIFIED'
            AND expires_at > CURRENT_TIMESTAMP
        `;
      } else if (
        current.status !== 'WAITING_FOR_MQTT' &&
        current.status !== 'CONNECTED'
      ) {
        throw new ConflictException({
          code: 'PAIRING_SESSION_NOT_READY',
          message: 'Identifica primero el Shelly compatible en la sesión.',
        });
      }

      const latest = await this.loadAndAuthorize(
        tx,
        homeId,
        sessionId,
        sessionToken,
      );
      if (latest.status !== 'CONNECTED') {
        return {
          ...this.toResponse(latest),
          completion: {
            ready: false,
            code: 'PAIRING_MQTT_NOT_CONFIRMED',
            message:
              'El backend todavía no ha observado una conexión MQTT autenticada e individual para este dispositivo.',
          },
        };
      }

      try {
        const device = await tx.device.create({
          data: {
            id_home: homeId,
            name: name.trim(),
            status: 'ACTIVE',
            connectivity_status: 'ONLINE',
            is_on: false,
            current_power_w: null,
            deleted_at: null,
            manufacturer_device_id: latest.manufacturer_device_id,
            transport_type: 'WIFI',
            messaging_protocol: 'MQTT',
          },
        });

        await tx.$executeRaw`
          UPDATE devices.device_pairing_session
          SET status = 'COMPLETED', completed_device_id = ${device.id_device}::uuid
          WHERE id_device_pairing_session = ${sessionId}::uuid
            AND id_home = ${homeId}::uuid AND id_user = ${userId}::uuid
            AND status = 'CONNECTED' AND expires_at > CURRENT_TIMESTAMP
        `;

        const completed = await this.loadAndAuthorize(
          tx,
          homeId,
          sessionId,
          sessionToken,
        );
        if (completed.status !== 'COMPLETED') {
          throw new ConflictException({
            code: 'PAIRING_SESSION_STATE_CHANGED',
            message:
              'La sesión cambió; consulta su estado antes de reintentar.',
          });
        }

        return {
          ...this.toResponse(completed),
          completion: { ready: true, deviceId: device.id_device },
          device: {
            id: device.id_device,
            homeId: device.id_home,
            name: device.name,
            manufacturerDeviceId: device.manufacturer_device_id,
            transportType: device.transport_type,
            messagingProtocol: device.messaging_protocol,
          },
        };
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          throw new ConflictException({
            code: 'PAIRING_DEVICE_ALREADY_REGISTERED',
            message: 'Este Shelly ya fue registrado.',
          });
        }
        throw error;
      }
    });
  }

  private async loadAndAuthorize(
    tx: Prisma.TransactionClient,
    homeId: string,
    sessionId: string,
    token: string,
  ): Promise<PairingRow> {
    const rows = await tx.$queryRaw<PairingRow[]>`
      SELECT id_device_pairing_session, id_home, method, status,
        manufacturer_device_id, model_code, firmware_version, identity_reported_at,
        expires_at, completed_device_id, failure_code, created_at, token_hash
      FROM devices.device_pairing_session
      WHERE id_device_pairing_session = ${sessionId}::uuid AND id_home = ${homeId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (!row)
      throw new NotFoundException({
        code: 'PAIRING_SESSION_NOT_FOUND',
        message: 'No se encontró la sesión.',
      });
    if (!this.constantTimeEqual(row.token_hash, this.sha256(token))) {
      throw new ForbiddenException({
        code: 'PAIRING_TOKEN_INVALID',
        message: 'Token de pairing inválido.',
      });
    }
    return row;
  }

  private async expireIfNeeded(
    tx: Prisma.TransactionClient,
    row: PairingRow,
  ): Promise<void> {
    if (
      row.expires_at.getTime() > Date.now() ||
      !ACTIVE_STATES.includes(row.status)
    )
      return;
    await tx.$executeRaw`
      UPDATE devices.device_pairing_session
      SET status = 'EXPIRED', manufacturer_device_id = NULL, model_code = NULL,
          firmware_version = NULL, identity_reported_at = NULL
      WHERE id_device_pairing_session = ${row.id_device_pairing_session}::uuid
        AND status = ANY(${ACTIVE_STATES}::text[]) AND expires_at <= CURRENT_TIMESTAMP
    `;
  }

  private toResponse(row: PairingRow) {
    return {
      sessionId: row.id_device_pairing_session,
      homeId: row.id_home,
      method: row.method,
      status: row.status,
      expiresAt: row.expires_at,
      identity: row.manufacturer_device_id
        ? {
            manufacturerDeviceId: row.manufacturer_device_id,
            modelCode: row.model_code,
            generation: 4,
            firmwareVersion: row.firmware_version,
            reportedAt: row.identity_reported_at,
            verification: 'MOBILE_REPORTED_UNVERIFIED',
          }
        : null,
      completion:
        row.status === 'COMPLETED'
          ? { deviceId: row.completed_device_id }
          : null,
      failureCode: row.failure_code,
    };
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private constantTimeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {
      code?: unknown;
      meta?: { code?: unknown; message?: unknown };
    };
    return (
      candidate.code === 'P2002' ||
      candidate.meta?.code === '23505' ||
      (typeof candidate.meta?.message === 'string' &&
        candidate.meta.message.includes('23505'))
    );
  }
}
