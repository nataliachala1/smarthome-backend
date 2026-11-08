import { Body, Controller, Headers, Header, HttpCode, HttpException, HttpStatus,
  Param, ParseUUIDPipe, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
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
import { ShellyMqttBootstrapAction } from '../../application/services/shelly-mqtt-bootstrap.action';
import { ShellyMqttOperationRequestDto } from '../../application/dto/shelly-mqtt-operation-request.dto';
/** VPS DEV bootstrap is enabled only with vpsPairing; the lab stays local-only. */
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
  @Header('Vary','Authorization, X-Pairing-Token')
  @ApiHeader({name:'X-Pairing-Token',required:true})
  @ApiHeader({
    name: 'X-SmartHome-Lab-Network-Approval',
    required: false,
    description: 'Required only by the local lab profile; ignored in VPS DEV.',
  })
  @ApiOperation({
    summary: 'Briefly hand out the already prepared individual identity',
    description: 'Requires a JWT, the home OWNER, a pairing token and a PREPARED_DISABLED operation. Does not confirm MQTT authentication.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Authorization, TLS, broker or uncertain state; do not retry blindly.',
  })
  async authorize(@CurrentUser() user:AuthenticatedUser,
    @Param('homeId',ParseUUIDPipe) homeId:string,
    @Param('sessionId',ParseUUIDPipe) sessionId:string,
    @Headers('x-pairing-token') token:string,
    @Headers('x-smarthome-lab-network-approval') approval:string,
    @Body() body:ShellyMqttOperationRequestDto) {
    try {
      return await this.action.authorize({userId:user.userId,homeId,sessionId,
        sessionToken:token,operationId:body?.operationId ?? '',
        labTrustConfirmed:approval==='isolated-dev-lan-only'});
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({code:'MQTT_BOOTSTRAP_NOT_AUTHORIZED_OR_UNCERTAIN'});
    }
  }
}
