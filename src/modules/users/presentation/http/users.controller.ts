import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';

import { UpdateMyPreferencesDto } from '../../application/dto/update-my-preferences.dto';
import { GetMyPreferencesUseCase } from '../../application/use-cases/get-my-preferences.use-case';
import { UpdateMyPreferencesUseCase } from '../../application/use-cases/update-my-preferences.use-case';
import { UpdateMyProfileDto } from '../../application/dto/update-my-profile.dto';
import { GetMyProfileUseCase } from '../../application/use-cases/get-my-profile.use-case';
import { UpdateMyProfileUseCase } from '../../application/use-cases/update-my-profile.use-case';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('api/v1/users')
export class UsersController {
  constructor(
    private readonly getMyProfileUseCase: GetMyProfileUseCase,
    private readonly updateMyProfileUseCase: UpdateMyProfileUseCase,
    private readonly getMyPreferencesUseCase: GetMyPreferencesUseCase,
    private readonly updateMyPreferencesUseCase: UpdateMyPreferencesUseCase,
  ) {}

  @Get('me')
  async getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.getMyProfileUseCase.execute(user.userId);
  }

  @Patch('me')
  async updateMyProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMyProfileDto,
  ) {
    return this.updateMyProfileUseCase.execute(user.userId, dto);
  }

  @Get('me/preferences')
  async getMyPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.getMyPreferencesUseCase.execute(user.userId);
  }

  @Patch('me/preferences')
  async updateMyPreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMyPreferencesDto,
  ) {
    return this.updateMyPreferencesUseCase.execute(user.userId, dto);
  }
}