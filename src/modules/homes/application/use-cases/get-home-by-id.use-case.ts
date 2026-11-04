import { Injectable } from '@nestjs/common';

import { HomeRepository } from '../../domain/repositories/home.repository';

export interface GetHomeByIdInput {
  userId: string;
  homeId: string;
}

export interface GetHomeByIdOutput {
  id: string;
  createdBy: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class GetHomeByIdUseCase {
  constructor(
    private readonly homeRepository: HomeRepository,
  ) {}

  async execute(
    input: GetHomeByIdInput,
  ): Promise<GetHomeByIdOutput | null> {
    const home = await this.homeRepository.findById(
      input.userId,
      input.homeId,
    );

    if (!home) {
      return null;
    }

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
