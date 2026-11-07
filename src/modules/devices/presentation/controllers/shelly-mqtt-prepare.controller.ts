import {
  Controller,
  Headers,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';
import { ShellyMqttPrepareAction } from '../../application/services/shelly-mqtt-prepare.action';

/**
 * Opt-in route to move an operation forward to PREPARED_DISABLED.
 * VPS DEV registers it only with the validated TLS+DEV profile; it never returns
 * passwords or enables the broker identity.
 */
@Controller('api/v1/homes/:homeId/shelly/setup-sessions/:sessionId/mqtt')
@ApiTags('shelly')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class ShellyMqttPrepareController {
  constructor(private readonly action: ShellyMqttPrepareAction) {}

  @Post('prepare')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store, private, max-age=0')
  @Header('Pragma', 'no-cache')
  @Header('Vary', 'Authorization, X-Pairing-Token')
  @ApiHeader({ name: 'X-Pairing-Token', required: true })
  @ApiOperation({ summary: 'Preparar identidad MQTT DESHABILITADA (solo development opt-in)' })
  @ApiServiceUnavailableResponse({
    description: 'Uncertain result or pending reconciliation; do not retry blindly.',
  })
  async prepare(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Headers('x-pairing-token') pairingToken: string,
  ) {
    if (!pairingToken) {
      // Same authentication criterion as the /identify and /complete endpoints.
      throw new ServiceUnavailableException({ code: 'PAIRING_TOKEN_REQUIRED' });
    }
    try {
      return await this.action.execute({
        userId: user.userId,
        homeId,
        sessionId,
        sessionToken: pairingToken,
      });
    } catch (error) {
      // The session service keeps the HTTP authorization errors.
      if (error instanceof HttpException) throw error;
      // Do not leak SQL responses or broker administrative errors to the mobile app.
      throw new ServiceUnavailableException({
        code: 'MQTT_PREPARATION_OUTCOME_REQUIRES_RECONCILIATION',
      });
    }
  }
}
