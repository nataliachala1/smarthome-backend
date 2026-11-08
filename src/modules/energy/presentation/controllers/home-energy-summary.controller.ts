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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';

import { EnergyMonthQueryDto } from '../../application/dto/energy-month-query.dto';
import { HomeEnergySummaryResponse } from '../../application/dto/home-energy-summary.response';
import { GetHomeEnergySummaryUseCase } from '../../application/use-cases/get-home-energy-summary.use-case';

@Controller('api/v1/homes/:homeId/energy/summary')
@ApiTags('energy')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiParam({ name: 'homeId', description: 'Home UUID', format: 'uuid' })
@ApiUnauthorizedResponse({ description: 'JWT ausente, vencido o revocado' })
export class HomeEnergySummaryController {
  constructor(
    private readonly getHomeEnergySummaryUseCase: GetHomeEnergySummaryUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Month summary: kWh and estimated cost using the historical tariff of each reading (OWNER or authorized MEMBER)',
  })
  @ApiOkResponse({ type: HomeEnergySummaryResponse })
  @ApiBadRequestResponse({ description: 'Invalid UUID or month' })
  @ApiForbiddenResponse({
    description:
      'No consumption detail permission (GUEST, no membership or no view_consumption)',
  })
  async getSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Query() query: EnergyMonthQueryDto,
  ): Promise<HomeEnergySummaryResponse> {
    return this.getHomeEnergySummaryUseCase.execute({
      userId: user.userId,
      homeId,
      month: query.month,
    });
  }
}
