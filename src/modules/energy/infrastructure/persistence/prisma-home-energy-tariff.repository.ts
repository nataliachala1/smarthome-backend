import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../../../generated/prisma/client';
import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';
import { isPostgresAccessDeniedError } from '../../../../infrastructure/database/prisma/prisma-error.util';

import { HomeEnergyTariff } from '../../domain/entities/home-energy-tariff.entity';
import { HomeEnergyTariffAlreadyExistsError } from '../../domain/errors/energy.errors';
import {
  CreateHomeEnergyTariffData,
  HomeEnergyTariffRepository,
} from '../../domain/repositories/home-energy-tariff.repository';

import {
  assertCanManageEnergy,
  assertCanReadEnergy,
  isUniqueViolation,
  energyAccessDeniedError,
  EnergyAccessKind,
} from './energy-access';
import {
  PrismaHomeEnergyTariffMapper,
  toDbDate,
} from './prisma-home-energy-tariff.mapper';

/**
 * Todas las operaciones corren dentro de withUserContext (RLS por transacción):
 * - lectura: consumption.fn_can_read_detail (OWNER o MEMBER con view_consumption)
 * - escritura: homes.fn_can_manage_home (OWNER activo de hogar activo)
 */
@Injectable()
export class PrismaHomeEnergyTariffRepository implements HomeEnergyTariffRepository {
  constructor(private readonly prismaRls: PrismaRlsService) {}

  async findAllByHome(
    userId: string,
    homeId: string,
  ): Promise<HomeEnergyTariff[]> {
    return this.run(userId, 'read', async (tx) => {
      await assertCanReadEnergy(tx, homeId);

      const rows = await tx.home_energy_tariff.findMany({
        where: { id_home: homeId },
        orderBy: { effective_from: 'desc' },
      });

      return rows.map((row) => PrismaHomeEnergyTariffMapper.toDomain(row));
    });
  }

  async findEffectiveAt(
    userId: string,
    homeId: string,
    date: string,
  ): Promise<HomeEnergyTariff | null> {
    return this.run(userId, 'read', async (tx) => {
      await assertCanReadEnergy(tx, homeId);

      const row = await tx.home_energy_tariff.findFirst({
        where: {
          id_home: homeId,
          effective_from: { lte: toDbDate(date) },
        },
        orderBy: { effective_from: 'desc' },
      });

      return row ? PrismaHomeEnergyTariffMapper.toDomain(row) : null;
    });
  }

  async create(
    userId: string,
    data: CreateHomeEnergyTariffData,
  ): Promise<HomeEnergyTariff> {
    return this.run(userId, 'manage', async (tx) => {
      await assertCanManageEnergy(tx, data.homeId);

      const row = await tx.home_energy_tariff.create({
        data: {
          id_home: data.homeId,
          unit_price_cop_kwh: data.unitPriceCopKwh,
          effective_from: toDbDate(data.effectiveFrom),
        },
      });

      return PrismaHomeEnergyTariffMapper.toDomain(row);
    });
  }

  private async run<T>(
    userId: string,
    access: EnergyAccessKind,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prismaRls.withUserContext(userId, operation);
    } catch (error) {
      // 42501 (privilegio o política RLS): se reporta según la operación,
      // sin exponer detalles SQL.
      if (isPostgresAccessDeniedError(error)) {
        throw energyAccessDeniedError(access);
      }

      if (isUniqueViolation(error)) {
        throw new HomeEnergyTariffAlreadyExistsError();
      }

      throw error;
    }
  }
}
