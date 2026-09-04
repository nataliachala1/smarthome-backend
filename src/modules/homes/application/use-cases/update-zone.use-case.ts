import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ZoneRepository } from '../../domain/repositories/zone.repository';

export interface UpdateZoneInput {
  userId: string;
  homeId: string;
  zoneId: string;
  name?: string;
  type?: string;
}

@Injectable()
export class UpdateZoneUseCase {
  constructor(
    private readonly zoneRepository: ZoneRepository,
  ) {}

  async execute(input: UpdateZoneInput) {
    const current = await this.zoneRepository.findById(
      input.userId,
      input.homeId,
      input.zoneId,
    );

    if (!current) {
      throw new NotFoundException(
        'Zona no encontrada',
      );
    }

    const zone = await this.zoneRepository.update({
      userId: input.userId,
      homeId: input.homeId,
      zoneId: input.zoneId,
      name: input.name?.trim(),
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
  }
}