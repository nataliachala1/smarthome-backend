import { UserPreference } from '../entities/user-preference.entity';

export interface UpdateUserPreferenceInput {
  language?: string;
  theme?: string;
  dateFormat?: string;
  timeFormat?: string;
  timezone?: string;
}

export abstract class UserPreferenceRepository {
  abstract findOrCreateByUserId(userId: string): Promise<UserPreference>;

  abstract updateByUserId(
    userId: string,
    input: UpdateUserPreferenceInput,
  ): Promise<UserPreference>;
}