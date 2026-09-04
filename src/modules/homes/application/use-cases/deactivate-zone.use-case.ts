import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ZoneRepository } from '../../domain/repositories/zone.repository';

export interface DeactivateZoneInput {
  userId: string;
  homeId: string;
  zoneId: string;
}

@Injectable()
export class DeactivateZoneUseCase {
  constructor(
    private readonly zoneRepository: ZoneRepository,
  ) {}

  async execute(
    input: DeactivateZoneInput,
  ): Promise<void> {
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

    await this.zoneRepository.deactivate(
      input.userId,
      input.homeId,
      input.zoneId,
    );
  }
}