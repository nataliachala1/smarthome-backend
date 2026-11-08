import type { Prisma } from '../../../../../generated/prisma/client';

import {
  EnergyManageAccessDeniedError,
  EnergyReadAccessDeniedError,
} from '../../domain/errors/energy.errors';

/**
 * Economic read: OWNER, or an active MEMBER with view_consumption, in an active home
 * (the OWNER also in a deactivated home). A GUEST never passes.
 * Must run inside the withUserContext transaction.
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

/** Write: only an active OWNER, with an active account, of an active home. */
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

/** Kind of operation on economic data: read or configure. */
export type EnergyAccessKind = 'read' | 'manage';

/**
 * Domain error for an access rejection according to the kind of operation.
 * Used when translating a PostgreSQL rejection (42501, privilege or RLS policy):
 * a denied read must never be reported as a denied write.
 */
export function energyAccessDeniedError(
  kind: EnergyAccessKind,
): EnergyReadAccessDeniedError | EnergyManageAccessDeniedError {
  return kind === 'read'
    ? new EnergyReadAccessDeniedError()
    : new EnergyManageAccessDeniedError();
}

/** Prisma code for a unique constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
