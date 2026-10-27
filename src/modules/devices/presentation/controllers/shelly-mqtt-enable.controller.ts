import {
  Body, Controller, Headers, Header, HttpCode, HttpException,
  HttpStatus, Param, ParseUUIDPipe, Post, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';
import { ShellyMqttEnableCoordinator } from '../../application/services/shelly-mqtt-enable.coordinator';

/**
 * Development-only: la comprobacion de MQTT.GetConfig procedente del movil
 * NO es prueba de autenticacion. Este controlador JAMAS marca CONNECTED.
 * El broker y SQL030 cercan el cambio posterior a AWAITING_AUTH.
 */
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
  @ApiHeader({ name: 'X-Pairing-Token', required: true })
  @ApiHeader({ name: 'X-SmartHome-Lab-Network-Approval', required: true })
  async enable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Headers('x-pairing-token') token: string,
    @Headers('x-smarthome-lab-network-approval') approval: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (process.env.NODE_ENV !== 'development' ||
        process.env.SHELLY_MQTT_DEV_DI_ENABLED !== 'true' ||
        process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP !== 'true' ||
        !token || approval !== 'isolated-dev-lan-only' ||
        typeof body?.operationId !== 'string' ||
        body.localConfigurationReadbackVerified !== true) {
      throw new ServiceUnavailableException({code: 'MQTT_ENABLE_DEV_AUTHORIZATION_REQUIRED'});
    }
    try {
      return await this.coordinator.enable({
        userId: user.userId, homeId, sessionId, sessionToken: token,
        operationId: body.operationId,
        localConfigurationReadbackVerified: true,
        explicitlyTrustedLocalNetwork: true,
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Una respuesta incierta de Mosquitto/SQL se reconcilia; JAMAS se reintenta.
      throw new ServiceUnavailableException({code: 'MQTT_ENABLE_OUTCOME_REQUIRES_RECONCILIATION'});
    }
  }
}
