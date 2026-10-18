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

  private async authorizeControl(
    tx: Prisma.TransactionClient,
    deviceId: string,
  ): Promise<void> {
    const [access] =
      await tx.$queryRaw<
        { allowed: boolean }[]
      >`
        SELECT devices.fn_has_device_permission(${deviceId}::uuid, 'control') AS allowed
      `;

    if (!access?.allowed) {
      throw new DeviceAccessDeniedError();
    }
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
      return await this.prismaRls.withUserContext(
        userId,
        async (tx) => {
          await this.authorize(
            tx,
            homeId,
            false,
          );

          const isOwner =
            await this.isOwner(
              tx,
              homeId,
            );

          const row =
            await tx.device.findFirst({
              where: {
                id_device:
                  deviceId,

                id_home:
                  homeId,

                deleted_at:
                  null,

                ...(isOwner
                  ? {}
                  : {
                      status:
                        'ACTIVE',
                    }),
              },
            });

          return row
            ? PrismaDeviceMapper.toDomain(
                row,
              )
            : null;
        },
      );
    } catch (error) {
      this.translateError(error);
    }
  }

  async findForControl(
  userId: string,
  homeId: string,
  deviceId: string,
  ): Promise<Device | null> {
    try {
      return await this.prismaRls.withUserContext(
        userId,
        async (tx) => {
          await this.authorizeControl(
            tx,
            deviceId,
          );

          const [row] = await tx.$queryRaw<{
            id_device: string; id_home: string; name: string; status: string;
            connectivity_status: string; is_on: boolean; current_power_w: Prisma.Decimal | null;
            manufacturer_device_id: string | null; transport_type: string | null;
            messaging_protocol: string | null; created_at: Date; updated_at: Date; deleted_at: Date | null;
          }[]>`SELECT * FROM devices.fn_device_control_target(${homeId}::uuid, ${deviceId}::uuid)`;

          return row ? new Device({
            id: row.id_device, homeId: row.id_home, name: row.name, status: row.status,
            connectivityStatus: row.connectivity_status, isOn: row.is_on,
            currentPowerW: row.current_power_w === null ? null : Number(row.current_power_w),
            manufacturerDeviceId: row.manufacturer_device_id, transportType: row.transport_type,
            messagingProtocol: row.messaging_protocol, createdAt: row.created_at,
            updatedAt: row.updated_at, deletedAt: row.deleted_at,
          }) : null;
        },
      );
    } catch (error) {
      this.translateError(error);
    }
  }

  async canReadDetailedConsumption(userId: string, deviceId: string): Promise<boolean> {
    return this.prismaRls.withUserContext(userId, async (tx) => {
      const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`
        SELECT consumption.fn_can_read_device_detail(${deviceId}::uuid) AS allowed
      `;
      return Boolean(row?.allowed);
    });
  }

  async canViewDevice(userId: string, deviceId: string): Promise<boolean> {
    return this.prismaRls.withUserContext(userId, async (tx) => {
      const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`
        SELECT devices.fn_has_device_permission(${deviceId}::uuid, 'view') AS allowed
      `;
      return Boolean(row?.allowed);
    });
  }

  async create(userId: string, data: CreateDeviceData): Promise<Device> {
    try {
      return await this.prismaRls.withUserContext(userId, async (tx) => {
        await this.authorize(tx, data.homeId, true);
        const raw = await tx.device.create({
          data: {
            id_home: data.homeId,
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
          where: { id_device: deviceId, id_home: homeId, deleted_at: null, },
        });
        if (!current) throw new DeviceAccessDeniedError();

        const normalized = {
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

  async deactivate(
    userId: string,
    homeId: string,
    deviceId: string,
  ): Promise<Device> {
    try {
      return await this.prismaRls.withUserContext(userId, async (tx) => {
        await this.authorize(tx, homeId, true);
        const current = await tx.device.findFirst({
          where: { id_device: deviceId, id_home: homeId, deleted_at: null, },
        });
        if (!current) throw new DeviceAccessDeniedError();
        const raw = await tx.device.update({
          where: { id_device: deviceId },
          data: {
            status: 'DEACTIVATED',
            deleted_at: null,
            is_on: false,
            connectivity_status:
              'OFFLINE',
          },
        });
        return PrismaDeviceMapper.toDomain(raw);
      });
    } catch (error) {
      this.translateError(error);
    }
  }

    async activate(
    userId: string,
    homeId: string,
    deviceId: string,
  ): Promise<Device> {
    try {
      return await this.prismaRls.withUserContext(
        userId,
        async (tx) => {
          await this.authorize(
            tx,
            homeId,
            true,
          );

          const current =
            await tx.device.findFirst({
              where: {
                id_device:
                  deviceId,

                id_home:
                  homeId,

                deleted_at:
                  null,
              },
            });

          if (!current) {
            throw new DeviceAccessDeniedError();
          }

          const raw =
            await tx.device.update({
              where: {
                id_device:
                  deviceId,
              },

              data: {
                status:
                  'ACTIVE',

                /*
                * La conectividad real la
                * actualizará MQTT.
                */
                connectivity_status:
                  'OFFLINE',

                is_on:
                  false,
              },
            });

          return PrismaDeviceMapper.toDomain(
            raw,
          );
        },
      );
    } catch (error) {
      this.translateError(error);
    }
  }

  async delete(
    userId: string,
    homeId: string,
    deviceId: string,
    ): Promise<void> {
    try {
      await this.prismaRls.withUserContext(
        userId,
        async (tx) => {
          await this.authorize(
            tx,
            homeId,
            true,
          );

          const current =
            await tx.device.findFirst({
              where: {
                id_device:
                  deviceId,

                id_home:
                  homeId,

                deleted_at:
                  null,
              },
            });

          if (!current) {
            throw new DeviceAccessDeniedError();
          }

          const now =
            new Date();

          await tx.device.update({
            where: {
              id_device:
                deviceId,
            },

            data: {
              status:
                'DEACTIVATED',

              deleted_at:
                now,

              is_on:
                false,

              connectivity_status:
                'OFFLINE',
            },
          });
        },
      );
    } catch (error) {
      this.translateError(error);
    }
  }

  async findInactiveByHome(
  userId: string,
  homeId: string,
): Promise<Device[]> {
  try {
    return await this.prismaRls.withUserContext(
      userId,
      async (tx) => {
        await this.authorize(
          tx,
          homeId,
          true,
        );

        const rows =
          await tx.device.findMany({
            where: {
              id_home:
                homeId,

              status:
                'DEACTIVATED',

              deleted_at:
                null,
            },

            orderBy: {
              name:
                'asc',
            },
          });

        return rows.map(
          PrismaDeviceMapper.toDomain,
        );
      },
    );
  } catch (error) {
    this.translateError(error);
  }
}

  private async isOwner(
    tx: Prisma.TransactionClient,
    homeId: string,
  ): Promise<boolean> {
    const [access] = await tx.$queryRaw<
      { is_owner: boolean }[]
    >`SELECT homes.fn_is_home_owner(${homeId}::uuid) AS is_owner`;
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
