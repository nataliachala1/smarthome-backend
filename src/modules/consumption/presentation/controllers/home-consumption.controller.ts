import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';

import { GetHomeConsumptionSummaryQueryDto } from '../../application/dto/get-home-consumption-summary-query.dto';
import { GetHomeConsumptionSummaryUseCase } from '../../application/use-cases/get-home-consumption-summary.use-case';

import { ListHomeConsumptionQueryDto } from '../../application/dto/list-home-consumption-query.dto';
import { ListHomeConsumptionUseCase } from '../../application/use-cases/list-home-consumption.use-case';

@Controller('api/v1/homes/:homeId/consumption')
@ApiTags('consumption')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class HomeConsumptionController {
  constructor(
    private readonly getHomeConsumptionSummaryUseCase: GetHomeConsumptionSummaryUseCase,
    private readonly listHomeConsumptionUseCase: ListHomeConsumptionUseCase,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Consultar resumen de consumo del hogar: OWNER, MEMBER o GUEST',
  })
  @ApiParam({ name: 'homeId', description: 'UUID del hogar', format: 'uuid' })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Fecha inicial en formato ISO',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'Fecha final en formato ISO',
  })
  @ApiOkResponse({
    description: 'Resumen agregado de consumo del hogar',
  })
  @ApiBadRequestResponse({
    description: 'UUID o rango de fechas inválido',
  })
  @ApiForbiddenResponse({
    description: 'Sin membresía activa en el hogar',
  })


    async summaryByHome(
        @CurrentUser() user: AuthenticatedUser,
        @Param('homeId', ParseUUIDPipe) homeId: string,
        @Query() query: GetHomeConsumptionSummaryQueryDto,
    ) {
    return this.getHomeConsumptionSummaryUseCase.execute({
      userId: user.userId,
      homeId,
      from: query.from,
      to: query.to,
    });
  }

    @Get()
    @ApiOperation({
    summary: 'Consultar historial de consumo del hogar: OWNER, MEMBER o GUEST',
    })
    @ApiParam({ name: 'homeId', description: 'UUID del hogar', format: 'uuid' })
    @ApiQuery({
    name: 'from',
    required: false,
    description: 'Fecha inicial en formato ISO',
    })
    @ApiQuery({
    name: 'to',
    required: false,
    description: 'Fecha final en formato ISO',
    })
    @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Cantidad máxima de registros, entre 1 y 200',
    })
    @ApiOkResponse({
    description: 'Lecturas históricas de consumo del hogar',
    })
    @ApiBadRequestResponse({
    description: 'UUID, fechas o límite inválidos',
    })
    @ApiForbiddenResponse({
    description: 'Sin membresía activa en el hogar',
    })
    async listByHome(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Query() query: ListHomeConsumptionQueryDto,
    ) {
    return this.listHomeConsumptionUseCase.execute({
        userId: user.userId,
        homeId,
        from: query.from,
        to: query.to,
        limit: query.limit,
    });
  }
}