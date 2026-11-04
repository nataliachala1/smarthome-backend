import { Injectable } from '@nestjs/common';

import { UserPreference } from '../../domain/entities/user-preference.entity';
import {
  UpdateUserPreferenceInput,
  UserPreferenceRepository,
} from '../../domain/repositories/user-preference.repository';

@Injectable()
export class UpdateMyPreferencesUseCase {
  constructor(
    private readonly userPreferenceRepository: UserPreferenceRepository,
  ) {}

  async execute(
    userId: string,
    input: UpdateUserPreferenceInput,
  ): Promise<UserPreference> {
    return this.userPreferenceRepository.updateByUserId(userId, input);
  }
}