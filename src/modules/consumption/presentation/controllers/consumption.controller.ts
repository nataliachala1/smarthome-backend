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

import { GetDeviceDailyConsumptionQueryDto } from '../../application/dto/get-device-daily-consumption-query.dto';
import { GetDeviceDailyConsumptionUseCase } from '../../application/use-cases/get-device-daily-consumption.use-case';

@Controller('api/v1/homes/:homeId/devices/:deviceId/consumption')
@ApiTags('consumption')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class ConsumptionController {
  constructor(
    private readonly listDeviceConsumptionUseCase: ListDeviceConsumptionUseCase,
    private readonly getDeviceConsumptionSummaryUseCase: GetDeviceConsumptionSummaryUseCase,
    private readonly getDeviceDailyConsumptionUseCase: GetDeviceDailyConsumptionUseCase,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Get the consumption summary of a device: OWNER or MEMBER',
  })
  @ApiParam({ name: 'homeId', description: 'Home UUID', format: 'uuid' })
  @ApiParam({
    name: 'deviceId',
    description: 'Device UUID',
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
    description: 'Aggregated consumption summary of the device',
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID or date range',
  })
  @ApiForbiddenResponse({
    description: 'No active membership in the home',
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

  @Get('daily')
  @ApiOperation({
    summary: 'Get the daily consumption of a device for charts',
  })
  @ApiParam({ name: 'homeId', description: 'Home UUID', format: 'uuid' })
  @ApiParam({
    name: 'deviceId',
    description: 'Device UUID',
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
    description: 'Device consumption grouped by day',
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID or date range',
  })
  @ApiForbiddenResponse({
    description: 'No active membership in the home',
  })
  @ApiNotFoundResponse({
    description: 'Dispositivo no encontrado',
  })
  async dailyByDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Query() query: GetDeviceDailyConsumptionQueryDto,
  ) {
    return this.getDeviceDailyConsumptionUseCase.execute({
      userId: user.userId,
      homeId,
      deviceId,
      from: query.from,
      to: query.to,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'Get the historical consumption of a device: OWNER or MEMBER',
  })
  @ApiParam({ name: 'homeId', description: 'Home UUID', format: 'uuid' })
  @ApiParam({
    name: 'deviceId',
    description: 'Device UUID',
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
    description: 'Maximum number of records, between 1 and 200',
  })
  @ApiOkResponse({
    description: 'Historical consumption readings of the device',
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID, dates or limit',
  })
  @ApiForbiddenResponse({
    description: 'No active membership in the home',
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
