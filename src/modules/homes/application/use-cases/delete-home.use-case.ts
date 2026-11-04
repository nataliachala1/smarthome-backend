import { Injectable } from '@nestjs/common';

import { HomeRepository } from '../../domain/repositories/home.repository';

export interface DeleteHomeInput {
  userId: string;
  homeId: string;
}

export interface DeleteHomeOutput {
  deleted: boolean;
}

@Injectable()
export class DeleteHomeUseCase {
  constructor(private readonly homeRepository: HomeRepository) {}

  async execute(input: DeleteHomeInput): Promise<DeleteHomeOutput> {
    await this.homeRepository.deleteIfNoDevices(
      input.userId,
      input.homeId,
    );

    return {
      deleted: true,
    };
  }
}