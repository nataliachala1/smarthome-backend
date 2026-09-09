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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';

import { ListDeviceConsumptionQueryDto } from '../../application/dto/list-device-consumption-query.dto';
import { ListDeviceConsumptionUseCase } from '../../application/use-cases/list-device-consumption.use-case';

import { GetDeviceConsumptionSummaryQueryDto } from '../../application/dto/get-device-consumption-summary-query.dto';
import { GetDeviceConsumptionSummaryUseCase } from '../../application/use-cases/get-device-consumption-summary.use-case';

@Controller('api/v1/homes/:homeId/devices/:deviceId/consumption')
@ApiTags('consumption')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class ConsumptionController {
  constructor(
    private readonly listDeviceConsumptionUseCase: ListDeviceConsumptionUseCase,
    private readonly getDeviceConsumptionSummaryUseCase: GetDeviceConsumptionSummaryUseCase,
  ) {}

  @Get('summary')
@ApiOperation({
  summary:
    'Consultar resumen de consumo de un dispositivo: OWNER, MEMBER o GUEST',
})
@ApiParam({ name: 'homeId', description: 'UUID del hogar', format: 'uuid' })
@ApiParam({
  name: 'deviceId',
  description: 'UUID del dispositivo',
  format: 'uuid',
})
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
  description: 'Resumen agregado de consumo del dispositivo',
})
@ApiBadRequestResponse({
  description: 'UUID o rango de fechas inválido',
})
@ApiForbiddenResponse({
  description: 'Sin membresía activa en el hogar',
})
@ApiNotFoundResponse({
  description: 'Dispositivo no encontrado',
})
async summaryByDevice(
  @CurrentUser() user: AuthenticatedUser,
  @Param('homeId', ParseUUIDPipe) homeId: string,
  @Param('deviceId', ParseUUIDPipe) deviceId: string,
  @Query() query: GetDeviceConsumptionSummaryQueryDto,
) {
  return this.getDeviceConsumptionSummaryUseCase.execute({
    userId: user.userId,
    homeId,
    deviceId,
    from: query.from,
    to: query.to,
  });
}
  @Get()
  @ApiOperation({
    summary:
      'Consultar consumo histórico de un dispositivo: OWNER, MEMBER o GUEST',
  })
  @ApiParam({ name: 'homeId', description: 'UUID del hogar', format: 'uuid' })
  @ApiParam({
    name: 'deviceId',
    description: 'UUID del dispositivo',
    format: 'uuid',
  })
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
    description: 'Lecturas históricas de consumo del dispositivo',
  })
  @ApiBadRequestResponse({
    description: 'UUID, fechas o límite inválidos',
  })
  @ApiForbiddenResponse({
    description: 'Sin membresía activa en el hogar',
  })
  @ApiNotFoundResponse({
    description: 'Dispositivo no encontrado',
  })
  async listByDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Query() query: ListDeviceConsumptionQueryDto,
  ) {
    return this.listDeviceConsumptionUseCase.execute({
      userId: user.userId,
      homeId,
      deviceId,
      from: query.from,
      to: query.to,
      limit: query.limit,
    });
  }
}