import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { HomeRepository } from '../../domain/repositories/home.repository';

export interface DeactivateHomeInput {
  userId: string;
  homeId: string;
}

export interface DeactivateHomeOutput {
  id: string;
  createdBy: string;
  name: string;
  stratum: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class DeactivateHomeUseCase {
  constructor(
    private readonly homeRepository: HomeRepository,
  ) {}

  async execute(
    input: DeactivateHomeInput,
  ): Promise<DeactivateHomeOutput> {
    const current = await this.homeRepository.findById(
      input.userId,
      input.homeId,
    );

    if (!current) {
      throw new NotFoundException(
        'Hogar no encontrado',
      );
    }

    if (current.status === 'DEACTIVATED') {
      throw new ConflictException(
        'El hogar ya se encuentra desactivado',
      );
    }

    const home = await this.homeRepository.deactivate(
      input.userId,
      input.homeId,
    );

    return {
      id: home.id,
      createdBy: home.createdBy,
      name: home.name,
      stratum: home.stratum,
      status: home.status,
      createdAt: home.createdAt,
      updatedAt: home.updatedAt,
    };
  }
}