import {
  Controller,
  Headers,
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
 * 504.10: ruta LOCAL opt-in para avanzar una operacion hasta
 * PREPARED_DISABLED; la identidad del broker debe continuar deshabilitada.
 * NO exponer esta ruta en produccion antes del flujo de aprovisionamiento,
 * verificacion autenticada, revocacion y auditoria completos.
 */
@Controller('api/v1/homes/:homeId/shelly/setup-sessions/:sessionId/mqtt')
@ApiTags('shelly')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class ShellyMqttPrepareController {
  constructor(private readonly action: ShellyMqttPrepareAction) {}

  @Post('prepare')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'X-Pairing-Token', required: true })
  @ApiOperation({ summary: 'Preparar identidad MQTT DESHABILITADA (solo development opt-in)' })
  @ApiServiceUnavailableResponse({
    description: 'Resultado incierto o pendiente de reconciliacion; no reintentar ciegamente.',
  })
  async prepare(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Headers('x-pairing-token') pairingToken: string,
  ) {
    if (!pairingToken) {
      // Mismo criterio de autenticacion del endpoint /identify y /complete.
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
      // El servicio de sesiones conserva los errores de autorizacion HTTP.
      if (error instanceof HttpException) throw error;
      // No filtrar respuestas SQL ni errores administrativos del broker al movil.
      throw new ServiceUnavailableException({
        code: 'MQTT_PREPARATION_OUTCOME_REQUIRES_RECONCILIATION',
      });
    }
  }
}
