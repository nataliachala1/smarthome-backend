import { Injectable } from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

import { Zone } from '../../domain/entities/zone.entity';
import {
  CreateZoneData,
  UpdateZoneData,
  ZoneRepository,
} from '../../domain/repositories/zone.repository';

import { PrismaZoneMapper } from './prisma-zone.mapper';
import { ZoneNameAlreadyExistsError } from '../../domain/errors/zone-name-already-exists.error';
import { isPostgresAccessDeniedError } from '../../../../infrastructure/database/prisma/prisma-error.util';
import { HomeAccessDeniedError } from '../../domain/errors/home-access-denied.error';

@Injectable()
export class PrismaZoneRepository implements ZoneRepository {
  constructor(
    private readonly prismaRls: PrismaRlsService,
  ) {}

  async findAllByHome(
    userId: string,
    homeId: string,
  ): Promise<Zone[]> {
    return this.prismaRls.withUserContext(
      userId,
      async (tx) => {
        const zones = await tx.zone.findMany({
            where: {
                id_home: homeId,
                deleted_at: null,
            },
            orderBy: {
                name: 'asc',
            },
            });

        return zones.map(
          PrismaZoneMapper.toDomain,
        );
      },
    );
  }

    async findById(
    userId: string,
    homeId: string,
    zoneId: string,
    ): Promise<Zone | null> {
    return this.prismaRls.withUserContext(
        userId,
        async (tx) => {
        const raw = await tx.zone.findFirst({
            where: {
            id_zone: zoneId,
            id_home: homeId,
            deleted_at: null,
            },
        });

        return raw
            ? PrismaZoneMapper.toDomain(raw)
            : null;
        },
    );
    }

    async update(
    data: UpdateZoneData,
    ): Promise<Zone> {
    return this.prismaRls.withUserContext(
        data.userId,
        async (tx) => {
        const raw = await tx.zone.update({
            where: {
            id_zone: data.zoneId,
            },
            data: {
            ...(data.name !== undefined && {
                name: data.name,
            }),
            ...(data.type !== undefined && {
                type: data.type,
            }),
            },
        });

        return PrismaZoneMapper.toDomain(raw);
        },
    );
    }

    async deactivate(
    userId: string,
    homeId: string,
    zoneId: string,
    ): Promise<void> {
    await this.prismaRls.withUserContext(
        userId,
        async (tx) => {
        await tx.$executeRaw`
            UPDATE homes.zone
            SET deleted_at = NOW()
            WHERE id_zone = ${zoneId}::uuid
            AND id_home = ${homeId}::uuid
            AND deleted_at IS NULL
        `;
        },
    );
    }

            async create(
        data: CreateZoneData,
        ): Promise<Zone> {
        try {
            return await this.prismaRls.withUserContext(
            data.userId,
            async (tx) => {
                const raw = await tx.zone.create({
                data: {
                    id_home: data.homeId,
                    name: data.name,
                    type: data.type ?? null,
                },
                });

                return PrismaZoneMapper.toDomain(raw);
            },
            );
        } catch (error: unknown) {
            // 1. Verificar primero accesos denegados (fuera del IF de P2002)
            if (isPostgresAccessDeniedError(error)) {
            throw new HomeAccessDeniedError();
            }

            // 2. Verificar errores de unicidad de Prisma
            if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'P2002'
            ) {
            const meta =
                'meta' in error &&
                typeof error.meta === 'object' &&
                error.meta !== null
                ? error.meta
                : null;

            const cause =
                meta &&
                'driverAdapterError' in meta &&
                typeof meta.driverAdapterError === 'object' &&
                meta.driverAdapterError !== null &&
                'cause' in meta.driverAdapterError &&
                typeof meta.driverAdapterError.cause === 'object' &&
                meta.driverAdapterError.cause !== null
                ? meta.driverAdapterError.cause
                : null;

            if (
                cause &&
                'constraint' in cause &&
                typeof cause.constraint === 'object' &&
                cause.constraint !== null &&
                'index' in cause.constraint &&
                cause.constraint.index === 'uq_zone_name'
            ) {
                throw new ZoneNameAlreadyExistsError();
            }
            }

            // 3. ✅ OBLIGATORIO: Si no coincide con ninguna de tus excepciones personalizadas,
            // relanza el error original para que NestJS lo maneje y TypeScript esté seguro.
            throw error;
        }
    }
}