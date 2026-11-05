import { Injectable } from '@nestjs/common';

import { HomeRepository } from '../../domain/repositories/home.repository';

export interface ListHomesInput {
  userId: string;
}

export interface ListHomesOutput {
  id: string;
  createdBy: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ListHomesUseCase {
  constructor(
    private readonly homeRepository: HomeRepository,
  ) {}

  async execute(
    input: ListHomesInput,
  ): Promise<ListHomesOutput[]> {
    const homes =
      await this.homeRepository.findAllByUser(
        input.userId,
      );

    return homes.map((home) => ({
      id: home.id,
      createdBy: home.createdBy,
      name: home.name,
      status: home.status,
      createdAt: home.createdAt,
      updatedAt: home.updatedAt,
    }));
  }
}
