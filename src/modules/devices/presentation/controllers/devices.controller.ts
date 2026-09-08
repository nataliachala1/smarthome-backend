import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiConflictResponse,
  ApiOperation,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';

import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';

import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';

import { ListHomeDevicesUseCase } from '../../application/use-cases/list-home-devices.use-case';

import { CreateDeviceDto } from '../../application/dto/create-device.dto';

import { CreateDeviceUseCase } from '../../application/use-cases/create-device.use-case';

@Controller('api/v1/homes/:homeId/devices')
@ApiTags('devices')
@ApiBearerAuth()
@ApiBadRequestResponse({
  description: 'UUID, datos o tipo de dispositivo inválidos',
})
@ApiForbiddenResponse({
  description: 'Sin membresía activa o rol suficiente en el hogar',
})
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(
    private readonly listHomeDevicesUseCase: ListHomeDevicesUseCase,
    private readonly createDeviceUseCase: CreateDeviceUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar dispositivos activos del hogar: OWNER, MEMBER o GUEST',
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
  ) {
    return this.listHomeDevicesUseCase.execute(user.userId, homeId);
  }

  @Post()
  @ApiOperation({
    summary: 'Registrar un dispositivo directamente en el hogar: OWNER',
  })
  @ApiConflictResponse({
    description: 'Nombre activo o identificador de fabricante duplicado',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Body() dto: CreateDeviceDto,
  ) {
    return this.createDeviceUseCase.execute({
      userId: user.userId,
      homeId,
      deviceTypeId: dto.deviceTypeId,
      name: dto.name,
      manufacturerDeviceId: dto.manufacturerDeviceId,
      transportType: dto.transportType,
      messagingProtocol: dto.messagingProtocol,
    });
  }
}
