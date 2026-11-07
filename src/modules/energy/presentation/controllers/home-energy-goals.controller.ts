import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';

import { EnergyMonthQueryDto } from '../../application/dto/energy-month-query.dto';
import {
  HomeEnergyGoalResponse,
  MonthHomeEnergyGoalResponse,
} from '../../application/dto/home-energy-goal.response';
import { UpsertHomeEnergyGoalDto } from '../../application/dto/upsert-home-energy-goal.dto';
import { GetHomeEnergyGoalUseCase } from '../../application/use-cases/get-home-energy-goal.use-case';
import { UpsertHomeEnergyGoalUseCase } from '../../application/use-cases/upsert-home-energy-goal.use-case';
import { ParseEnergyMonthPipe } from '../pipes/parse-energy-month.pipe';

@Controller('api/v1/homes/:homeId/energy/goals')
@ApiTags('energy')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiParam({ name: 'homeId', description: 'Home UUID', format: 'uuid' })
@ApiUnauthorizedResponse({ description: 'JWT ausente, vencido o revocado' })
export class HomeEnergyGoalsController {
  constructor(
    private readonly getHomeEnergyGoalUseCase: GetHomeEnergyGoalUseCase,
    private readonly upsertHomeEnergyGoalUseCase: UpsertHomeEnergyGoalUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Budget and target of the month (OWNER or authorized MEMBER); goal is null when not configured',
  })
  @ApiOkResponse({ type: MonthHomeEnergyGoalResponse })
  @ApiBadRequestResponse({ description: 'Invalid UUID or month' })
  @ApiForbiddenResponse({
    description:
      'No consumption detail permission (GUEST, no membership or no view_consumption)',
  })
  async getByMonth(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Query() query: EnergyMonthQueryDto,
  ): Promise<MonthHomeEnergyGoalResponse> {
    return this.getHomeEnergyGoalUseCase.execute({
      userId: user.userId,
      homeId,
      month: query.month,
    });
  }

  @Put(':month')
  @ApiOperation({
    summary:
      'Create or replace the month budget and target (active home OWNER only). Idempotent',
  })
  @ApiParam({ name: 'month', description: 'Mes YYYY-MM', example: '2026-11' })
  @ApiOkResponse({ type: HomeEnergyGoalResponse })
  @ApiBadRequestResponse({
    description:
      'Invalid month or decimals, missing field, or budget and target both null',
  })
  @ApiForbiddenResponse({ description: 'Only the OWNER of an active home' })
  @ApiConflictResponse({
    description: 'Concurrent write of the same month; retry',
  })
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('month', ParseEnergyMonthPipe) month: string,
    @Body() dto: UpsertHomeEnergyGoalDto,
  ): Promise<HomeEnergyGoalResponse> {
    return this.upsertHomeEnergyGoalUseCase.execute({
      userId: user.userId,
      homeId,
      month,
      monthlyBudgetCop: dto.monthlyBudgetCop,
      targetKwh: dto.targetKwh,
    });
  }
}
