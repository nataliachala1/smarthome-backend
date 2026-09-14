import { Injectable } from '@nestjs/common';

import { HomeRepository } from '../../domain/repositories/home.repository';

export interface CreateHomeInput {
  userId: string;
  name: string;
}

export interface CreateHomeOutput {
  id: string;
  createdBy: string;
  name: string;
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
    });

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
