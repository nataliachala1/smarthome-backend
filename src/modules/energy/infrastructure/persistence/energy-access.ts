import type { Prisma } from '../../../../../generated/prisma/client';

import {
  EnergyManageAccessDeniedError,
  EnergyReadAccessDeniedError,
} from '../../domain/errors/energy.errors';

/**
 * Lectura económica: OWNER, o MEMBER activo con view_consumption, en hogar activo
 * (OWNER también en hogar desactivado). GUEST nunca pasa.
 * Debe ejecutarse dentro de la transacción de withUserContext.
 */
export async function assertCanReadEnergy(
  tx: Prisma.TransactionClient,
  homeId: string,
): Promise<void> {
  const [access] = await tx.$queryRaw<{ allowed: boolean }[]>`
    SELECT consumption.fn_can_read_detail(${homeId}::uuid) AS allowed
  `;

  if (!access?.allowed) {
    throw new EnergyReadAccessDeniedError();
  }
}

/** Escritura: solo OWNER activo, con cuenta activa, de un hogar activo. */
export async function assertCanManageEnergy(
  tx: Prisma.TransactionClient,
  homeId: string,
): Promise<void> {
  const [access] = await tx.$queryRaw<{ allowed: boolean }[]>`
    SELECT homes.fn_can_manage_home(${homeId}::uuid) AS allowed
  `;

  if (!access?.allowed) {
    throw new EnergyManageAccessDeniedError();
  }
}

/** Tipo de operación sobre datos económicos: consultar o configurar. */
export type EnergyAccessKind = 'read' | 'manage';

/**
 * Error de dominio para un rechazo de acceso según el tipo de operación.
 * Se usa al traducir un rechazo de PostgreSQL (42501, privilegio o política RLS):
 * una lectura denegada nunca debe reportarse como denegación de escritura.
 */
export function energyAccessDeniedError(
  kind: EnergyAccessKind,
): EnergyReadAccessDeniedError | EnergyManageAccessDeniedError {
  return kind === 'read'
    ? new EnergyReadAccessDeniedError()
    : new EnergyManageAccessDeniedError();
}

/** Código Prisma de violación de restricción única. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
