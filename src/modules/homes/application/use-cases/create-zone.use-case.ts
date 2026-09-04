import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { HomeAccessDeniedError } from '../../domain/errors/home-access-denied.error';
import { ZoneNameAlreadyExistsError } from '../../domain/errors/zone-name-already-exists.error';
import { ZoneRepository } from '../../domain/repositories/zone.repository';

export interface CreateZoneInput {
  userId: string;
  homeId: string;
  name: string;
  type?: string;
}

export interface CreateZoneOutput {
  id: string;
  homeId: string;
  name: string;
  type: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CreateZoneUseCase {
  constructor(
    private readonly zoneRepository: ZoneRepository,
  ) {}

  async execute(
    input: CreateZoneInput,
  ): Promise<CreateZoneOutput> {
    try {
      const zone = await this.zoneRepository.create({
        userId: input.userId,
        homeId: input.homeId,
        name: input.name.trim(),
        type: input.type?.trim(),
      });

      return {
        id: zone.id,
        homeId: zone.homeId,
        name: zone.name,
        type: zone.type,
        createdAt: zone.createdAt,
        updatedAt: zone.updatedAt,
      };
    } catch (error: unknown) {
      if (error instanceof ZoneNameAlreadyExistsError) {
        throw new ConflictException(error.message);
      }

      if (error instanceof HomeAccessDeniedError) {
        throw new ForbiddenException(error.message);
      }

      throw error;
    }
  }
}