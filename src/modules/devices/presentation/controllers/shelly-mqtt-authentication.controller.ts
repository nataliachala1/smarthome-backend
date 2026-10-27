import {
  Body, Controller, Headers, Header, HttpCode, HttpException,
  HttpStatus, Param, ParseUUIDPipe, Post, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';
import { ShellyMqttAuthenticationAction } from '../../application/services/shelly-mqtt-authentication.action';
import { ShellyMqttOperationRequestDto } from '../../application/dto/shelly-mqtt-operation-request.dto';

/** Authenticated HTTP trigger; only the worker can persist broker evidence. */
@Controller('api/v1/homes/:homeId/shelly/setup-sessions/:sessionId/mqtt')
@UseGuards(JwtAuthGuard)
@ApiTags('shelly')
@ApiBearerAuth('access-token')
export class ShellyMqttAuthenticationController {
  constructor(private readonly action: ShellyMqttAuthenticationAction) {}

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, private, max-age=0')
  @Header('Pragma', 'no-cache')
  @Header('Vary', 'Authorization, X-Pairing-Token')
  @ApiHeader({ name: 'X-Pairing-Token', required: true })
  @ApiOperation({
    summary: 'Solicitar desafío MQTT Shelly y confirmar únicamente evidencia persistida',
  })
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Headers('x-pairing-token') token: string,
    @Body() body: ShellyMqttOperationRequestDto,
  ) {
    if (process.env.NODE_ENV !== 'production' ||
        process.env.APP_ENV !== 'development' ||
        process.env.SHELLY_MQTT_DEV_DI_ENABLED !== 'true' ||
        process.env.SHELLY_MQTT_VPS_DEV_TLS_ENABLED !== 'true' ||
        process.env.SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED !== 'true' ||
        process.env.SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED !== 'true' ||
        process.env.MQTT_ENABLED !== 'true' ||
        process.env.MQTT_TLS_REJECT_UNAUTHORIZED === 'false' ||
        process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
        process.env.SHELLY_MQTT_AUTH_DEV_DI_ENABLED !== 'true' ||
        process.env.SHELLY_MQTT_VPS_DEV_AUTH_WORKER_ENABLED !== 'true' ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(token ?? '') ||
        typeof body?.operationId !== 'string') {
      throw new ServiceUnavailableException({
        code: 'MQTT_AUTH_WORKER_NOT_AUTHORIZED',
      });
    }
    try {
      return await this.action.confirm({
        userId: user.userId,
        homeId,
        sessionId,
        sessionToken: token,
        operationId: body.operationId,
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // The app must poll the pairing session after an uncertain outcome.
      throw new ServiceUnavailableException({
        code: 'MQTT_AUTH_OUTCOME_REQUIRES_RECONCILIATION',
      });
    }
  }
}
