import { Injectable } from '@nestjs/common';

import { UserPreference } from '../../domain/entities/user-preference.entity';
import { UserPreferenceRepository } from '../../domain/repositories/user-preference.repository';

@Injectable()
export class GetMyPreferencesUseCase {
  constructor(
    private readonly userPreferenceRepository: UserPreferenceRepository,
  ) {}

  async execute(userId: string): Promise<UserPreference> {
    return this.userPreferenceRepository.findOrCreateByUserId(userId);
  }
}