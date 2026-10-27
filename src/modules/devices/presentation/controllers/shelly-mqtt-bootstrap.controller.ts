import { Body, Controller, Headers, Header, HttpCode, HttpException, HttpStatus,
  Param, ParseUUIDPipe, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';
import { ShellyMqttBootstrapAction } from '../../application/services/shelly-mqtt-bootstrap.action';
/** Solo disponible cuando DOS opt-ins de laboratorio esten habilitados en development. */
@Controller('api/v1/homes/:homeId/shelly/setup-sessions/:sessionId/mqtt')
@UseGuards(JwtAuthGuard)
@ApiTags('shelly')
@ApiBearerAuth('access-token')
export class ShellyMqttBootstrapController {
  constructor(private readonly action:ShellyMqttBootstrapAction) {}
  @Post('bootstrap')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control','no-store, private, max-age=0')
  @Header('Pragma','no-cache')
  @ApiHeader({name:'X-Pairing-Token',required:true})
  async authorize(@CurrentUser() user:AuthenticatedUser,
    @Param('homeId',ParseUUIDPipe) homeId:string,
    @Param('sessionId',ParseUUIDPipe) sessionId:string,
    @Headers('x-pairing-token') token:string,
    @Headers('x-smarthome-lab-network-approval') approval:string,
    @Body() body:Record<string,unknown>) {
    try {
      return await this.action.authorize({userId:user.userId,homeId,sessionId,
        sessionToken:token,operationId:typeof body?.operationId === 'string' ? body.operationId : '',
        labTrustConfirmed:approval==='isolated-dev-lan-only'});
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({code:'MQTT_BOOTSTRAP_NOT_AUTHORIZED_OR_UNCERTAIN'});
    }
  }
}
