import { Injectable } from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

import { Home } from '../../domain/entities/home.entity';

import {
  CreateHomeData,
  HomeRepository,
  UpdateHomeData,
} from '../../domain/repositories/home.repository';

import { PrismaHomeMapper } from './prisma-home.mapper';

import { isPostgresAccessDeniedError } from '../../../../infrastructure/database/prisma/prisma-error.util';
import { HomeAccessDeniedError } from '../../domain/errors/home-access-denied.error';

@Injectable()
export class PrismaHomeRepository
  implements HomeRepository
{
  constructor(
    private readonly prismaRls: PrismaRlsService,
  ) {}

  async findAllByUser(
    userId: string,
  ): Promise<Home[]> {
    return this.prismaRls.withUserContext(
      userId,
      async (tx) => {
        const rows = await tx.home.findMany({
          where: {
            deleted_at: null,
          },
          orderBy: {
            created_at: 'desc',
          },
        });

        return rows.map(
          PrismaHomeMapper.toDomain,
        );
      },
    );
  }

 async findById(
  userId: string,
  homeId: string,
): Promise<Home | null> {
  return this.prismaRls.withUserContext(
    userId,
    async (tx) => {
      const raw = await tx.home.findFirst({
        where: {
          id_home: homeId,
        },
      });

      return raw
        ? PrismaHomeMapper.toDomain(raw)
        : null;
    },
  );
}

async deactivate(
  userId: string,
  homeId: string,
): Promise<Home> {
  return this.prismaRls.withUserContext(
    userId,
    async (tx) => {
      const raw = await tx.home.update({
        where: {
          id_home: homeId,
        },
        data: {
          status: 'DEACTIVATED',
          deleted_at: new Date(),
        },
      });

      return PrismaHomeMapper.toDomain(raw);
    },
  );
}

async reactivate(
  userId: string,
  homeId: string,
): Promise<Home> {
  return this.prismaRls.withUserContext(
    userId,
    async (tx) => {
      const raw = await tx.home.update({
        where: {
          id_home: homeId,
        },
        data: {
          status: 'ACTIVE',
          deleted_at: null,
        },
      });

      return PrismaHomeMapper.toDomain(raw);
    },
  );
}

async update(
  data: UpdateHomeData,
): Promise<Home> {
  try {
    return await this.prismaRls.withUserContext(
      data.userId,
      async (tx) => {
        const raw = await tx.home.update({
          where: {
            id_home: data.homeId,
          },
          data: {
            ...(data.name !== undefined && {
              name: data.name,
            }),
          },
        });

        return PrismaHomeMapper.toDomain(raw);
      },
    );
  } catch (error: unknown) {
  if (isPostgresAccessDeniedError(error)) {
    throw new HomeAccessDeniedError();
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2025'
  ) {
    throw new HomeAccessDeniedError();
  }

  throw error;
}
}

  async create(
    data: CreateHomeData,
  ): Promise<Home> {
    return this.prismaRls.withUserContext(
      data.userId,
      async (tx) => {
        const home = await tx.home.create({
          data: {
            created_by: data.userId,
            name: data.name,
            status: 'ACTIVE',
          },
        });

        await tx.home_member.create({
          data: {
            id_home: home.id_home,
            id_user: data.userId,
            role: 'OWNER',
            status: 'ACTIVE',
            accepted_at: new Date(),
          },
        });

        return PrismaHomeMapper.toDomain(home);
      },
    );
  }
}
