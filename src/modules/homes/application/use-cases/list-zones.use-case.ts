import { Injectable } from '@nestjs/common';

import { ZoneRepository } from '../../domain/repositories/zone.repository';

export interface ListZonesInput {
  userId: string;
  homeId: string;
}

export interface ListZonesOutput {
  id: string;
  homeId: string;
  name: string;
  type: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ListZonesUseCase {
  constructor(
    private readonly zoneRepository: ZoneRepository,
  ) {}

  async execute(
    input: ListZonesInput,
  ): Promise<ListZonesOutput[]> {
    const zones =
      await this.zoneRepository.findAllByHome(
        input.userId,
        input.homeId,
      );

    return zones.map((zone) => ({
      id: zone.id,
      homeId: zone.homeId,
      name: zone.name,
      type: zone.type,
      createdAt: zone.createdAt,
      updatedAt: zone.updatedAt,
    }));
  }
}