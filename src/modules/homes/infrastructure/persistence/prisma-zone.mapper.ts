import { Zone } from '../../domain/entities/zone.entity';

interface PrismaZoneRecord {
  id_zone: string;
  id_home: string;
  name: string;
  type: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export class PrismaZoneMapper {
  static toDomain(raw: PrismaZoneRecord): Zone {
    return new Zone({
      id: raw.id_zone,
      homeId: raw.id_home,
      name: raw.name,
      type: raw.type,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      deletedAt: raw.deleted_at,
    });
  }
}