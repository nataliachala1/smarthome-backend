import { Module } from '@nestjs/common';

import { forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';

import { UsersController } from './presentation/http/users.controller';

import { UserRepository } from './domain/repositories/user.repository';
import { UserPreferenceRepository } from './domain/repositories/user-preference.repository';

import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository';
import { PrismaUserPreferenceRepository } from './infrastructure/persistence/prisma-user-preference.repository';

import { GetMyPreferencesUseCase } from './application/use-cases/get-my-preferences.use-case';
import { UpdateMyPreferencesUseCase } from './application/use-cases/update-my-preferences.use-case';
import { GetMyProfileUseCase } from './application/use-cases/get-my-profile.use-case';
import { UpdateMyProfileUseCase } from './application/use-cases/update-my-profile.use-case';

@Module({
  imports: [PrismaModule, forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [
    GetMyPreferencesUseCase,
    UpdateMyPreferencesUseCase,
    GetMyProfileUseCase,
    UpdateMyProfileUseCase,
    {
      provide: UserRepository,
      useClass: PrismaUserRepository,
    },
    {
      provide: UserPreferenceRepository,
      useClass: PrismaUserPreferenceRepository,
    },
  ],
  exports: [UserRepository, UserPreferenceRepository],
})
export class UsersModule {}