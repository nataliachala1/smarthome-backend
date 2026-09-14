import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { HomeAccessDeniedError } from '../../domain/errors/home-access-denied.error';
import { HomeRepository } from '../../domain/repositories/home.repository';

export interface UpdateHomeInput {
  userId: string;
  homeId: string;
  name?: string;
}

export interface UpdateHomeOutput {
  id: string;
  createdBy: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class UpdateHomeUseCase {
  constructor(
    private readonly homeRepository: HomeRepository,
  ) {}

  async execute(
    input: UpdateHomeInput,
  ): Promise<UpdateHomeOutput> {
    const current = await this.homeRepository.findById(
      input.userId,
      input.homeId,
    );

    if (!current) {
      throw new NotFoundException(
        'Hogar no encontrado',
      );
    }

    try {
      const home = await this.homeRepository.update({
        userId: input.userId,
        homeId: input.homeId,
        name: input.name?.trim(),
      });

      return {
        id: home.id,
        createdBy: home.createdBy,
        name: home.name,
        status: home.status,
        createdAt: home.createdAt,
        updatedAt: home.updatedAt,
      };
    } catch (error: unknown) {
      if (error instanceof HomeAccessDeniedError) {
        throw new ForbiddenException(error.message);
      }

      throw error;
    }
  }
}
