import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { HomeRepository } from '../../domain/repositories/home.repository';

export interface ReactivateHomeInput {
  userId: string;
  homeId: string;
}

export interface ReactivateHomeOutput {
  id: string;
  createdBy: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ReactivateHomeUseCase {
  constructor(
    private readonly homeRepository: HomeRepository,
  ) {}

  async execute(
    input: ReactivateHomeInput,
  ): Promise<ReactivateHomeOutput> {
    const current = await this.homeRepository.findById(
      input.userId,
      input.homeId,
    );

    if (!current) {
      throw new NotFoundException(
        'Hogar no encontrado',
      );
    }

    if (current.status === 'ACTIVE') {
      throw new ConflictException(
        'El hogar ya se encuentra activo',
      );
    }

    const home = await this.homeRepository.reactivate(
      input.userId,
      input.homeId,
    );

    return {
      id: home.id,
      createdBy: home.createdBy,
      name: home.name,
      status: home.status,
      createdAt: home.createdAt,
      updatedAt: home.updatedAt,
    };
  }
}
