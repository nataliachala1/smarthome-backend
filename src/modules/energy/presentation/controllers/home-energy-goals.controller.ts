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
@ApiParam({ name: 'homeId', description: 'UUID del hogar', format: 'uuid' })
@ApiUnauthorizedResponse({ description: 'JWT ausente, vencido o revocado' })
export class HomeEnergyGoalsController {
  constructor(
    private readonly getHomeEnergyGoalUseCase: GetHomeEnergyGoalUseCase,
    private readonly upsertHomeEnergyGoalUseCase: UpsertHomeEnergyGoalUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Presupuesto y meta del mes (OWNER o MEMBER autorizado); goal null si no hay configuración',
  })
  @ApiOkResponse({ type: MonthHomeEnergyGoalResponse })
  @ApiBadRequestResponse({ description: 'UUID o mes inválidos' })
  @ApiForbiddenResponse({
    description:
      'Sin permiso de detalle de consumo (GUEST, sin membresía o sin view_consumption)',
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
      'Crear o reemplazar presupuesto y meta del mes (solo OWNER de hogar activo). Idempotente',
  })
  @ApiParam({ name: 'month', description: 'Mes YYYY-MM', example: '2026-11' })
  @ApiOkResponse({ type: HomeEnergyGoalResponse })
  @ApiBadRequestResponse({
    description:
      'Mes o decimales inválidos, campo omitido, o presupuesto y meta ambos null',
  })
  @ApiForbiddenResponse({ description: 'Solo el OWNER de un hogar activo' })
  @ApiConflictResponse({
    description: 'Escritura simultánea del mismo mes; reintentar',
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
