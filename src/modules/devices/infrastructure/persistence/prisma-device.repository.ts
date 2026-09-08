import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../../generated/prisma/client';
import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';
import { isPostgresAccessDeniedError } from '../../../../infrastructure/database/prisma/prisma-error.util';
import { Device } from '../../domain/entities/device.entity';
import {
  CreateDeviceData,
  DeviceRepository,
  UpdateDeviceData,
} from '../../domain/repositories/device.repository';
import {
  DeviceAccessDeniedError,
  DeviceConflictError,
  InvalidDeviceReferenceError,
} from '../../domain/errors/device-persistence.error';
import { PrismaDeviceMapper } from './mappers/prisma-device.mapper';

@Injectable()
export class PrismaDeviceRepository implements DeviceRepository {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  private async authorize(
    tx: Prisma.TransactionClient,
    homeId: string,
    manage: boolean,
  ): Promise<void> {
    // Membership and operation share one transaction and the same rules as RLS.
    const [access] = manage
      ? await tx.$queryRaw<
          { allowed: boolean }[]
        >`SELECT homes.fn_can_manage_home(${homeId}::uuid) AS allowed`
      : await tx.$queryRaw<{ allowed: boolean }[]>`SELECT (
          homes.fn_is_home_owner(${homeId}::uuid) OR (
            homes.fn_is_home_active(${homeId}::uuid) AND
            homes.fn_is_home_member(${homeId}::uuid, ARRAY['MEMBER', 'GUEST']::text[])
          )) AS allowed`;
    if (!access?.allowed) throw new DeviceAccessDeniedError();
  }

  async findAllByHome(userId: string, homeId: string): Promise<Device[]> {
    try {
      return await this.prismaRls.withUserContext(userId, async (tx) => {
        await this.authorize(tx, homeId, false);
        const rows = await tx.device.findMany({
          where: { id_home: homeId, deleted_at: null, status: 'ACTIVE' },
          orderBy: { name: 'asc' },
        });
        return rows.map((row) => PrismaDeviceMapper.toDomain(row));
      });
    } catch (error) {
      this.translateError(error);
    }
  }

  async findById(
    userId: string,
    homeId: string,
    deviceId: string,
  ): Promise<Device | null> {
    try {
      return await this.prismaRls.withUserContext(userId, async (tx) => {
        await this.authorize(tx, homeId, false);
        const row = await tx.device.findFirst({
          where: {
            id_device: deviceId,
            id_home: homeId,
            ...(await this.isOwner(tx, homeId))
              ? {}
              : { status: 'ACTIVE', deleted_at: null },
          },
        });
        return row ? PrismaDeviceMapper.toDomain(row) : null;
      });
    } catch (error) {
      this.translateError(error);
    }
  }

  async create(userId: string, data: CreateDeviceData): Promise<Device> {
    try {
      return await this.prismaRls.withUserContext(userId, async (tx) => {
        await this.authorize(tx, data.homeId, true);
        const type = await tx.device_type.findFirst({
          where: { id_device_type: data.deviceTypeId, deleted_at: null },
        });
        if (!type) throw new InvalidDeviceReferenceError();
        const raw = await tx.device.create({
          data: {
            id_home: data.homeId,
            id_device_type: data.deviceTypeId,
            name: data.name.trim(),
            status: 'ACTIVE',
            connectivity_status: 'OFFLINE',
            is_on: false,
            current_power_w: null,
            deleted_at: null,
            manufacturer_device_id: data.manufacturerDeviceId,
            transport_type: data.transportType,
            messaging_protocol: data.messagingProtocol,
          },
        });
        return PrismaDeviceMapper.toDomain(raw);
      });
    } catch (error) {
      this.translateError(error);
    }
  }

  async update(
    userId: string,
    homeId: string,
    deviceId: string,
    data: UpdateDeviceData,
  ): Promise<Device> {
    try {
      return await this.prismaRls.withUserContext(userId, async (tx) => {
        await this.authorize(tx, homeId, true);
        const current = await tx.device.findFirst({
          where: { id_device: deviceId, id_home: homeId },
        });
        if (!current) throw new DeviceAccessDeniedError();
        if (data.deviceTypeId) {
          const type = await tx.device_type.findFirst({
            where: { id_device_type: data.deviceTypeId, deleted_at: null },
          });
          if (!type) throw new InvalidDeviceReferenceError();
        }
        const normalized = {
          ...(data.deviceTypeId !== undefined && { id_device_type: data.deviceTypeId }),
          ...(data.name !== undefined && { name: data.name.trim() }),
          ...(data.transportType !== undefined && {
            transport_type: data.transportType,
          }),
          ...(data.messagingProtocol !== undefined && {
            messaging_protocol: data.messagingProtocol,
          }),
        };
        const raw = await tx.device.update({
          where: { id_device: deviceId },
          data: normalized,
        });
        return PrismaDeviceMapper.toDomain(raw);
      });
    } catch (error) {
      this.translateError(error);
    }
  }

  async deactivate(userId: string, homeId: string, deviceId: string): Promise<Device> {
    try {
      return await this.prismaRls.withUserContext(userId, async (tx) => {
        await this.authorize(tx, homeId, true);
        const current = await tx.device.findFirst({
          where: { id_device: deviceId, id_home: homeId },
        });
        if (!current) throw new DeviceAccessDeniedError();
        const raw = await tx.device.update({
          where: { id_device: deviceId },
          data: {
            status: 'DEACTIVATED',
            deleted_at: new Date(),
            is_on: false,
          },
        });
        return PrismaDeviceMapper.toDomain(raw);
      });
    } catch (error) {
      this.translateError(error);
    }
  }

  private async isOwner(
    tx: Prisma.TransactionClient,
    homeId: string,
  ): Promise<boolean> {
    const [access] = await tx.$queryRaw<{ is_owner: boolean }[]>`SELECT homes.fn_is_home_owner(${homeId}::uuid) AS is_owner`;
    return Boolean(access?.is_owner);
  }

  private translateError(error: unknown): never {
    if (isPostgresAccessDeniedError(error)) throw new DeviceAccessDeniedError();
    if (typeof error === 'object' && error !== null && 'code' in error) {
      if (error.code === 'P2002') throw new DeviceConflictError();
      if (error.code === 'P2003') throw new InvalidDeviceReferenceError();
      if (error.code === 'P2025') throw new DeviceAccessDeniedError();
    }
    throw error;
  }
}
