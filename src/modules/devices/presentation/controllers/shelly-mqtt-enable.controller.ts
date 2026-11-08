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
import { selectShellyMqttProviderPlan } from '../../infrastructure/messaging/shelly-mqtt-deployment-mode';

/** Local readback is lab-only; VPS/production require backend and broker proof. */
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
    description: 'Required only by the local profile; VPS DEV does not trust this header.' })
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
    const plan = selectShellyMqttProviderPlan();
    const vpsProfile = plan.vpsAuthWorker;
    const productionProfile = plan.productionAuthWorker;
    const localAuthorized = localProfile &&
      approval === 'isolated-dev-lan-only' &&
      body?.localConfigurationReadbackVerified === true;
    if ((!localAuthorized && !vpsProfile && !productionProfile) || !token || !operationId) {
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
      // An uncertain Mosquitto/SQL response is reconciled; it is NEVER retried.
      throw new ServiceUnavailableException({code: 'MQTT_ENABLE_OUTCOME_REQUIRES_RECONCILIATION'});
    }
  }
}
