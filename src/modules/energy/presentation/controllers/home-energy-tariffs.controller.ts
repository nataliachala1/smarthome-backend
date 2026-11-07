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
@ApiParam({ name: 'homeId', description: 'Home UUID', format: 'uuid' })
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
      'COP/kWh tariff history of the home (OWNER or authorized MEMBER)',
  })
  @ApiOkResponse({ type: HomeEnergyTariffListResponse })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiForbiddenResponse({
    description:
      'No consumption detail permission (GUEST, no membership or no view_consumption)',
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
    summary: 'Tariff effective on a local date (OWNER or authorized MEMBER)',
  })
  @ApiOkResponse({
    type: CurrentHomeEnergyTariffResponse,
    description: 'tariff is null when no tariff is effective on the date',
  })
  @ApiBadRequestResponse({ description: 'Invalid UUID or date' })
  @ApiForbiddenResponse({ description: 'No consumption detail permission' })
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
      'Record a new tariff effective period (active home OWNER only)',
  })
  @ApiCreatedResponse({ type: HomeEnergyTariffResponse })
  @ApiBadRequestResponse({ description: 'Invalid UUID, price or date' })
  @ApiForbiddenResponse({ description: 'Only the OWNER of an active home' })
  @ApiConflictResponse({
    description: 'A tariff with that effective date already exists in the home',
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
