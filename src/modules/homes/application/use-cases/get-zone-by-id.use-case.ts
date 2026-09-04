import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ZoneRepository } from '../../domain/repositories/zone.repository';

export interface GetZoneByIdInput {
  userId: string;
  homeId: string;
  zoneId: string;
}

@Injectable()
export class GetZoneByIdUseCase {
  constructor(
    private readonly zoneRepository: ZoneRepository,
  ) {}

  async execute(input: GetZoneByIdInput) {
    const zone = await this.zoneRepository.findById(
      input.userId,
      input.homeId,
      input.zoneId,
    );

    if (!zone) {
      throw new NotFoundException(
        'Zona no encontrada',
      );
    }

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