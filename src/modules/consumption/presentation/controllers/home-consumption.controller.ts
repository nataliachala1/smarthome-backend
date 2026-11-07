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

import { GetHomeDailyConsumptionQueryDto } from '../../application/dto/get-home-daily-consumption-query.dto';
import { GetHomeDailyConsumptionUseCase } from '../../application/use-cases/get-home-daily-consumption.use-case';

@Controller('api/v1/homes/:homeId/consumption')
@ApiTags('consumption')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class HomeConsumptionController {
  constructor(
    private readonly getHomeConsumptionSummaryUseCase: GetHomeConsumptionSummaryUseCase,
    private readonly listHomeConsumptionUseCase: ListHomeConsumptionUseCase,
    private readonly getHomeDailyConsumptionUseCase: GetHomeDailyConsumptionUseCase,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'Get the home summary: full for OWNER/MEMBER; energy and period only for GUEST',
  })
  @ApiParam({ name: 'homeId', description: 'Home UUID', format: 'uuid' })
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
    description:
      'OWNER/MEMBER receive statistics. GUEST receives homeId, from, to and totalEnergyDeltaKwh.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID or date range',
  })
  @ApiForbiddenResponse({
    description: 'No active membership in the home',
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

  @Get('daily')
  @ApiOperation({
    summary: 'Get the daily home consumption for charts',
  })
  @ApiParam({ name: 'homeId', description: 'Home UUID', format: 'uuid' })
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
    description: 'Home consumption grouped by day',
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID or date range',
  })
  @ApiForbiddenResponse({
    description: 'No active membership in the home',
  })
  async dailyByHome(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Query() query: GetHomeDailyConsumptionQueryDto,
  ) {
    return this.getHomeDailyConsumptionUseCase.execute({
      userId: user.userId,
      homeId,
      from: query.from,
      to: query.to,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'Get the home consumption history: OWNER or MEMBER',
  })
  @ApiParam({ name: 'homeId', description: 'Home UUID', format: 'uuid' })
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
    description: 'Historical consumption readings of the home',
  })
  @ApiBadRequestResponse({
    description: 'Invalid UUID, dates or limit',
  })
  @ApiForbiddenResponse({
    description: 'No active membership in the home',
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
