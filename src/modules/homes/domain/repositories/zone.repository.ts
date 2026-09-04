import { Zone } from '../entities/zone.entity';

export interface CreateZoneData {
  userId: string;
  homeId: string;
  name: string;
  type?: string;
}

export interface UpdateZoneData {
  userId: string;
  homeId: string;
  zoneId: string;
  name?: string;
  type?: string | null;
}

export abstract class ZoneRepository {
  abstract findAllByHome(
    userId: string,
    homeId: string,
  ): Promise<Zone[]>;

  abstract findById(
    userId: string,
    homeId: string,
    zoneId: string,
  ): Promise<Zone | null>;

  abstract create(
    data: CreateZoneData,
  ): Promise<Zone>;

  abstract update(
    data: UpdateZoneData,
  ): Promise<Zone>;

  abstract deactivate(
    userId: string,
    homeId: string,
    zoneId: string,
  ): Promise<void>;
}