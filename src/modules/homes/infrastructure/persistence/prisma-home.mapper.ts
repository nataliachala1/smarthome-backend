import { home as PrismaHome } from '../../../../../generated/prisma/client';

import { Home } from '../../domain/entities/home.entity';

export class PrismaHomeMapper {
  static toDomain(raw: PrismaHome): Home {
    return new Home({
      id: raw.id_home,
      createdBy: raw.created_by,
      name: raw.name,
      stratum: raw.stratum,
      status: raw.status,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      deletedAt: raw.deleted_at,
    });
  }
}