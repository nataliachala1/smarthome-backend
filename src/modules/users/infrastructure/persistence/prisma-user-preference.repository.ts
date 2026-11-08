import { Injectable } from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';
import {
  UserPreference,
  PreferenceLanguage,
  PreferenceTheme,
  PreferenceTimeFormat,
} from '../../domain/entities/user-preference.entity';
import {
  UpdateUserPreferenceInput,
  UserPreferenceRepository,
} from '../../domain/repositories/user-preference.repository';

type RawUserPreference = {
  id_user: string;
  language: string;
  theme: string;
  date_format: string;
  time_format: string;
  timezone: string;
};

@Injectable()
export class PrismaUserPreferenceRepository
  implements UserPreferenceRepository
{
  constructor(private readonly prismaRls: PrismaRlsService) {}

  async findOrCreateByUserId(userId: string): Promise<UserPreference> {
    const raw = await this.prismaRls.withUserContext(userId, async (tx) => {
      return tx.user_preference.upsert({
        where: {
          id_user: userId,
        },
        update: {},
        create: {
          id_user: userId,
          language: 'es',
          theme: 'claro',
          date_format: 'DD/MM/YYYY',
          time_format: '24h',
          timezone: 'America/Bogota',

          // They exist in the DB, but are not exposed in the API by scope.
          currency: 'COP',
          temperature_unit: 'C',
        },
      });
    });

    return this.toDomain(raw);
  }

  async updateByUserId(
    userId: string,
    input: UpdateUserPreferenceInput,
  ): Promise<UserPreference> {
    const raw = await this.prismaRls.withUserContext(userId, async (tx) => {
      return tx.user_preference.upsert({
        where: {
          id_user: userId,
        },
        update: {
          ...(input.language !== undefined
            ? { language: input.language }
            : {}),
          ...(input.theme !== undefined
            ? { theme: input.theme }
            : {}),
          ...(input.dateFormat !== undefined
            ? { date_format: input.dateFormat }
            : {}),
          ...(input.timeFormat !== undefined
            ? { time_format: input.timeFormat }
            : {}),
          ...(input.timezone !== undefined
            ? { timezone: input.timezone }
            : {}),
          updated_at: new Date(),
        },
        create: {
          id_user: userId,
          language: input.language ?? 'es',
          theme: input.theme ?? 'claro',
          date_format: input.dateFormat ?? 'DD/MM/YYYY',
          time_format: input.timeFormat ?? '24h',
          timezone: input.timezone ?? 'America/Bogota',

          // They exist in the DB, but are not exposed in the API by scope.
          currency: 'COP',
          temperature_unit: 'C',
        },
      });
    });

    return this.toDomain(raw);
  }

  private toDomain(raw: RawUserPreference): UserPreference {
    return {
      userId: raw.id_user,
      language: raw.language as PreferenceLanguage,
      theme: raw.theme as PreferenceTheme,
      dateFormat: raw.date_format,
      timeFormat: raw.time_format as PreferenceTimeFormat,
      timezone: raw.timezone,
    };
  }
}