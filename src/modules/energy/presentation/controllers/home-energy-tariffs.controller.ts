import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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

import { CreateHomeEnergyTariffDto } from '../../application/dto/create-home-energy-tariff.dto';
import { CurrentHomeEnergyTariffQueryDto } from '../../application/dto/current-home-energy-tariff-query.dto';
import {
  CurrentHomeEnergyTariffResponse,
  HomeEnergyTariffListResponse,
  HomeEnergyTariffResponse,
} from '../../application/dto/home-energy-tariff.response';
import { CreateHomeEnergyTariffUseCase } from '../../application/use-cases/create-home-energy-tariff.use-case';
import { GetCurrentHomeEnergyTariffUseCase } from '../../application/use-cases/get-current-home-energy-tariff.use-case';
import { ListHomeEnergyTariffsUseCase } from '../../application/use-cases/list-home-energy-tariffs.use-case';

@Controller('api/v1/homes/:homeId/energy/tariffs')
@ApiTags('energy')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiParam({ name: 'homeId', description: 'UUID del hogar', format: 'uuid' })
@ApiUnauthorizedResponse({ description: 'JWT ausente, vencido o revocado' })
export class HomeEnergyTariffsController {
  constructor(
    private readonly listHomeEnergyTariffsUseCase: ListHomeEnergyTariffsUseCase,
    private readonly getCurrentHomeEnergyTariffUseCase: GetCurrentHomeEnergyTariffUseCase,
    private readonly createHomeEnergyTariffUseCase: CreateHomeEnergyTariffUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Historial de tarifas COP/kWh del hogar (OWNER o MEMBER autorizado)',
  })
  @ApiOkResponse({ type: HomeEnergyTariffListResponse })
  @ApiBadRequestResponse({ description: 'UUID inválido' })
  @ApiForbiddenResponse({
    description:
      'Sin permiso de detalle de consumo (GUEST, sin membresía o sin view_consumption)',
  })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
  ): Promise<HomeEnergyTariffListResponse> {
    return this.listHomeEnergyTariffsUseCase.execute({
      userId: user.userId,
      homeId,
    });
  }

  @Get('current')
  @ApiOperation({
    summary: 'Tarifa vigente para una fecha local (OWNER o MEMBER autorizado)',
  })
  @ApiOkResponse({
    type: CurrentHomeEnergyTariffResponse,
    description: 'tariff es null si no hay tarifa vigente para la fecha',
  })
  @ApiBadRequestResponse({ description: 'UUID o fecha inválidos' })
  @ApiForbiddenResponse({ description: 'Sin permiso de detalle de consumo' })
  async current(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Query() query: CurrentHomeEnergyTariffQueryDto,
  ): Promise<CurrentHomeEnergyTariffResponse> {
    return this.getCurrentHomeEnergyTariffUseCase.execute({
      userId: user.userId,
      homeId,
      at: query.at,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Registrar una nueva vigencia de tarifa (solo OWNER de hogar activo)',
  })
  @ApiCreatedResponse({ type: HomeEnergyTariffResponse })
  @ApiBadRequestResponse({ description: 'UUID, precio o fecha inválidos' })
  @ApiForbiddenResponse({ description: 'Solo el OWNER de un hogar activo' })
  @ApiConflictResponse({
    description: 'Ya existe una tarifa con esa fecha de vigencia en el hogar',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Body() dto: CreateHomeEnergyTariffDto,
  ): Promise<HomeEnergyTariffResponse> {
    return this.createHomeEnergyTariffUseCase.execute({
      userId: user.userId,
      homeId,
      unitPriceCopKwh: dto.unitPriceCopKwh,
      effectiveFrom: dto.effectiveFrom,
    });
  }
}
