import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';
import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';
import { HomePermissionsService } from '../../application/services/home-permissions.service';
import { SetHomeMemberPermissionsDto } from '../../application/dto/set-home-member-permissions.dto';
import { SetDevicePermissionsDto } from '../../application/dto/set-device-permissions.dto';

@Controller('api/v1/homes/:homeId/members/:memberId')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class HomePermissionsController {
  constructor(private readonly service: HomePermissionsService) {}

  @Get('permissions')
  getMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', new ParseUUIDPipe({ version: '4' })) homeId: string,
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
  ) { return this.service.getMember(user.userId, homeId, memberId); }

  @Put('permissions')
  setMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', new ParseUUIDPipe({ version: '4' })) homeId: string,
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Body() dto: SetHomeMemberPermissionsDto,
  ) { return this.service.setMember(user.userId, homeId, memberId, dto); }

  @Get('devices/:deviceId/permissions')
  getDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', new ParseUUIDPipe({ version: '4' })) homeId: string,
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Param('deviceId', new ParseUUIDPipe({ version: '4' })) deviceId: string,
  ) { return this.service.getDevice(user.userId, homeId, memberId, deviceId); }

  @Put('devices/:deviceId/permissions')
  setDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', new ParseUUIDPipe({ version: '4' })) homeId: string,
    @Param('memberId', new ParseUUIDPipe({ version: '4' })) memberId: string,
    @Param('deviceId', new ParseUUIDPipe({ version: '4' })) deviceId: string,
    @Body() dto: SetDevicePermissionsDto,
  ) {
    if (dto.canViewDevice === undefined && dto.canViewConsumption === undefined && dto.canControlDevice === undefined) {
      throw new BadRequestException('Indica al menos un permiso; usa null para heredar el permiso del hogar');
    }
    return this.service.setDevice(user.userId, homeId, memberId, deviceId, {
      canViewDevice: dto.canViewDevice,
      canViewConsumption: dto.canViewConsumption,
      canControlDevice: dto.canControlDevice,
    });
  }
}
