import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../../../generated/prisma/client';
import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

@Injectable()
export class HomePermissionsService {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  private async requireOwner(tx: Prisma.TransactionClient, homeId: string) {
    const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`
      SELECT homes.fn_can_manage_home(${homeId}::uuid) AS allowed
    `;
    if (!row?.allowed) throw new ForbiddenException('Solo OWNER puede gestionar permisos');
  }

  async getMember(userId: string, homeId: string, memberId: string) {
    return this.prismaRls.withUserContext(userId, async (tx) => {
      await this.requireOwner(tx, homeId);
      const [permission] = await tx.$queryRaw<{
        can_view_devices: boolean; can_view_consumption: boolean; can_control_devices: boolean;
      }[]>`SELECT * FROM homes.fn_get_member_permissions(${homeId}::uuid, ${memberId}::uuid)`;
      if (!permission) throw new NotFoundException('Membresía no encontrada');
      return {
        canViewDevices: permission.can_view_devices,
        canViewConsumption: permission.can_view_consumption,
        canControlDevices: permission.can_control_devices,
      };
    });
  }

  async setMember(userId: string, homeId: string, memberId: string, permissions: {
    canViewDevices: boolean; canViewConsumption: boolean; canControlDevices: boolean;
  }) {
    return this.prismaRls.withUserContext(userId, async (tx) => {
      await this.requireOwner(tx, homeId);
      const [result] = await tx.$queryRaw<{ updated: boolean }[]>`
        SELECT homes.fn_set_member_permissions(${homeId}::uuid, ${memberId}::uuid,
          ${permissions.canViewDevices}, ${permissions.canViewConsumption}, ${permissions.canControlDevices}) AS updated
      `;
      if (!result?.updated) throw new NotFoundException('Membresía no encontrada');
      return this.getMemberInTransaction(tx, homeId, memberId);
    });
  }

  async getDevice(userId: string, homeId: string, memberId: string, deviceId: string) {
    return this.prismaRls.withUserContext(userId, async (tx) => {
      await this.requireOwner(tx, homeId);
      const [permission] = await tx.$queryRaw<{
        can_view_device: boolean | null; can_view_consumption: boolean | null; can_control_device: boolean | null;
      }[]>`SELECT * FROM homes.fn_get_device_permissions(${homeId}::uuid, ${memberId}::uuid, ${deviceId}::uuid)`;
      if (!permission) throw new NotFoundException('Membresía o dispositivo no encontrado');
      return {
        canViewDevice: permission.can_view_device,
        canViewConsumption: permission.can_view_consumption,
        canControlDevice: permission.can_control_device,
      };
    });
  }

  async setDevice(userId: string, homeId: string, memberId: string, deviceId: string, permissions: {
    canViewDevice?: boolean | null; canViewConsumption?: boolean | null; canControlDevice?: boolean | null;
  }) {
    return this.prismaRls.withUserContext(userId, async (tx) => {
      await this.requireOwner(tx, homeId);
      const [current] = await tx.$queryRaw<{
        can_view_device: boolean | null; can_view_consumption: boolean | null; can_control_device: boolean | null;
      }[]>`SELECT * FROM homes.fn_get_device_permissions(${homeId}::uuid, ${memberId}::uuid, ${deviceId}::uuid)`;
      if (!current) throw new NotFoundException('Membresía o dispositivo no encontrado');
      const canViewDevice = permissions.canViewDevice === undefined ? current.can_view_device : permissions.canViewDevice;
      const canViewConsumption = permissions.canViewConsumption === undefined ? current.can_view_consumption : permissions.canViewConsumption;
      const canControlDevice = permissions.canControlDevice === undefined ? current.can_control_device : permissions.canControlDevice;
      const [result] = await tx.$queryRaw<{ updated: boolean }[]>`
        SELECT homes.fn_set_device_permissions(${homeId}::uuid, ${memberId}::uuid, ${deviceId}::uuid,
          ${canViewDevice}, ${canViewConsumption}, ${canControlDevice}) AS updated
      `;
      if (!result?.updated) throw new NotFoundException('Membresía o dispositivo no encontrado');
      const [permission] = await tx.$queryRaw<{
        can_view_device: boolean | null; can_view_consumption: boolean | null; can_control_device: boolean | null;
      }[]>`SELECT * FROM homes.fn_get_device_permissions(${homeId}::uuid, ${memberId}::uuid, ${deviceId}::uuid)`;
      return {
        canViewDevice: permission?.can_view_device ?? null,
        canViewConsumption: permission?.can_view_consumption ?? null,
        canControlDevice: permission?.can_control_device ?? null,
      };
    });
  }

  private async getMemberInTransaction(tx: Prisma.TransactionClient, homeId: string, memberId: string) {
    const [permission] = await tx.$queryRaw<{
      can_view_devices: boolean; can_view_consumption: boolean; can_control_devices: boolean;
    }[]>`
      SELECT * FROM homes.fn_get_member_permissions(${homeId}::uuid, ${memberId}::uuid)
    `;
    return {
      canViewDevices: permission.can_view_devices,
      canViewConsumption: permission.can_view_consumption,
      canControlDevices: permission.can_control_devices,
    };
  }
}
