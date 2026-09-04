import { Injectable } from '@nestjs/common';

import { HomeRepository } from '../../domain/repositories/home.repository';

export interface CreateHomeInput {
  userId: string;
  name: string;
  stratum: number;
}

export interface CreateHomeOutput {
  id: string;
  createdBy: string;
  name: string;
  stratum: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CreateHomeUseCase {
  constructor(
    private readonly homeRepository: HomeRepository,
  ) {}

  async execute(
    input: CreateHomeInput,
  ): Promise<CreateHomeOutput> {
    const home = await this.homeRepository.create({
      userId: input.userId,
      name: input.name.trim(),
      stratum: input.stratum,
    });

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