import {
  Body, Controller, Headers, Header, HttpCode, HttpException,
  HttpStatus, Param, ParseUUIDPipe, Post, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';
import { ShellyMqttEnableCoordinator } from '../../application/services/shelly-mqtt-enable.coordinator';
import { ShellyMqttOperationRequestDto } from '../../application/dto/shelly-mqtt-operation-request.dto';

/** Local readback is a gate only; VPS ignores mobile claims. Never marks CONNECTED. */
@Controller('api/v1/homes/:homeId/shelly/setup-sessions/:sessionId/mqtt')
@UseGuards(JwtAuthGuard)
@ApiTags('shelly')
@ApiBearerAuth('access-token')
export class ShellyMqttEnableController {
  constructor(private readonly coordinator: ShellyMqttEnableCoordinator) {}

  @Post('enable')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store, private, max-age=0')
  @Header('Pragma', 'no-cache')
  @Header('Vary', 'Authorization, X-Pairing-Token')
  @ApiHeader({ name: 'X-Pairing-Token', required: true })
  @ApiHeader({ name: 'X-SmartHome-Lab-Network-Approval', required: false,
    description: 'Requerido solo por el perfil local; VPS DEV no confía en este header.' })
  async enable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Headers('x-pairing-token') token: string,
    @Headers('x-smarthome-lab-network-approval') approval: string,
    @Body() body: ShellyMqttOperationRequestDto,
  ) {
    const operationId = body?.operationId ?? '';
    const localProfile = process.env.NODE_ENV === 'development' &&
      process.env.SHELLY_MQTT_DEV_DI_ENABLED === 'true' &&
      process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP === 'true';
    const vpsProfile = process.env.NODE_ENV === 'production' &&
      process.env.APP_ENV === 'development' &&
      process.env.SHELLY_MQTT_DEV_DI_ENABLED === 'true' &&
      process.env.SHELLY_MQTT_VPS_DEV_TLS_ENABLED === 'true' &&
      process.env.SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED === 'true' &&
      process.env.SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED === 'true' &&
      process.env.MQTT_ENABLED === 'true' &&
      process.env.MQTT_TLS_REJECT_UNAUTHORIZED !== 'false' &&
      process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' &&
      process.env.SHELLY_MQTT_AUTH_DEV_DI_ENABLED === 'true' &&
      process.env.SHELLY_MQTT_VPS_DEV_AUTH_WORKER_ENABLED === 'true';
    const localAuthorized = localProfile &&
      approval === 'isolated-dev-lan-only' &&
      body?.localConfigurationReadbackVerified === true;
    if ((!localAuthorized && !vpsProfile) || !token || !operationId) {
      throw new ServiceUnavailableException({code: 'MQTT_ENABLE_DEV_AUTHORIZATION_REQUIRED'});
    }
    try {
      const request = {
        userId: user.userId, homeId, sessionId, sessionToken: token,
        operationId,
      };
      return await this.coordinator.enable(localAuthorized ? {
        ...request,
        localConfigurationReadbackVerified: true,
        explicitlyTrustedLocalNetwork: true,
      } : request);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Una respuesta incierta de Mosquitto/SQL se reconcilia; JAMAS se reintenta.
      throw new ServiceUnavailableException({code: 'MQTT_ENABLE_OUTCOME_REQUIRES_RECONCILIATION'});
    }
  }
}
