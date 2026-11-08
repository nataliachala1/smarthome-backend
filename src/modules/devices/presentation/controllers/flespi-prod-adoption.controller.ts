import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';
import { FlespiProdAdoptionService } from '../../application/services/flespi-prod-adoption.service';

/** Absent from the route table unless the temporary PROD profile is selected. */
@Controller('api/v1/homes/:homeId/devices/flespi-temp')
@ApiTags('devices')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class FlespiProdAdoptionController {
  constructor(private readonly adoption: FlespiProdAdoptionService) {}

  @Post('adopt')
  @ApiOperation({
    summary: 'Adoptar temporalmente un Shelly Flespi autorizado (solo OWNER)',
  })
  adopt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
  ) {
    // No manufacturerDeviceId or MQTT credentials are accepted from HTTP.
    return this.adoption.adopt(user.userId, homeId);
  }
}
