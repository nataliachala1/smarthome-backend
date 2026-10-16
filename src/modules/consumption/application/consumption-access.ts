import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';

export async function authorizeConsumptionDetail(
  tx: Prisma.TransactionClient,
  homeId: string,
): Promise<void> {
  const [access] = await tx.$queryRaw<{ allowed: boolean }[]>`
    SELECT consumption.fn_can_read_detail(${homeId}::uuid) AS allowed
  `;
  if (!access?.allowed)
    throw new ForbiddenException({
      code: 'CONSUMPTION_DETAIL_FORBIDDEN',
      message: 'Sin permisos para consultar consumo detallado de este hogar',
    });
}

export async function authorizeDeviceConsumptionDetail(
  tx: Prisma.TransactionClient,
  deviceId: string,
): Promise<void> {
  const [access] = await tx.$queryRaw<{ allowed: boolean }[]>`
    SELECT consumption.fn_can_read_device_detail(${deviceId}::uuid) AS allowed
  `;
  if (!access?.allowed)
    throw new ForbiddenException({
      code: 'CONSUMPTION_DETAIL_FORBIDDEN',
      message: 'Sin permisos para consultar el consumo de este dispositivo',
    });
}

export interface HistoryDevice {
  id_device: string;
  name: string;
  manufacturer_device_id: string | null;
}

export function historyDevices(
  tx: Prisma.TransactionClient,
  homeId: string,
  deviceIds: string[],
): Promise<HistoryDevice[]> {
  return tx.$queryRaw<HistoryDevice[]>`
    SELECT * FROM consumption.fn_history_devices(${homeId}::uuid, ${deviceIds}::uuid[])
  `;
}

export async function requireHistoryDevice(
  tx: Prisma.TransactionClient,
  homeId: string,
  deviceId: string,
): Promise<void> {
  if (!(await historyDevices(tx, homeId, [deviceId])).length) {
    throw new NotFoundException('Dispositivo no encontrado');
  }
}
