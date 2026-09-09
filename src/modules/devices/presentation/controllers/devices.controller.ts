import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
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
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';

import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';

import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';

import { ListHomeDevicesUseCase } from '../../application/use-cases/list-home-devices.use-case';

import { CreateDeviceDto } from '../../application/dto/create-device.dto';
import { UpdateDeviceDto } from '../../application/dto/update-device.dto';
import { ControlDeviceDto } from '../../application/dto/control-device.dto';

import { CreateDeviceUseCase } from '../../application/use-cases/create-device.use-case';
import { GetDeviceByIdUseCase } from '../../application/use-cases/get-device-by-id.use-case';
import { UpdateDeviceUseCase } from '../../application/use-cases/update-device.use-case';
import { DeactivateDeviceUseCase } from '../../application/use-cases/deactivate-device.use-case';
import { ControlDeviceUseCase } from '../../application/use-cases/control-device.use-case';

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
    private readonly getDeviceByIdUseCase: GetDeviceByIdUseCase,
    private readonly updateDeviceUseCase: UpdateDeviceUseCase,
    private readonly deactivateDeviceUseCase: DeactivateDeviceUseCase,
    private readonly controlDeviceUseCase: ControlDeviceUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar dispositivos activos del hogar: OWNER, MEMBER o GUEST',
  })
  @ApiParam({ name: 'homeId', description: 'UUID del hogar', format: 'uuid' })
  @ApiOkResponse({ description: 'Lista de dispositivos activos del hogar' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
  ) {
    return this.listHomeDevicesUseCase.execute(user.userId, homeId);
  }

  @Get(':deviceId')
  @ApiOperation({
    summary: 'Consultar un dispositivo del hogar por id',
  })
  @ApiParam({ name: 'homeId', description: 'UUID del hogar', format: 'uuid' })
  @ApiParam({
    name: 'deviceId',
    description: 'UUID del dispositivo',
    format: 'uuid',
  })
  @ApiOkResponse({ description: 'Dispositivo autorizado' })
  async findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    const device = await this.getDeviceByIdUseCase.execute(
      user.userId,
      homeId,
      deviceId,
    );

    if (!device) {
      throw new NotFoundException('Dispositivo no encontrado');
    }

    return device;
  }

  @Post()
  @ApiOperation({
    summary: 'Registrar un dispositivo directamente en el hogar: OWNER',
  })
  @ApiConflictResponse({
    description: 'Nombre activo o identificador de fabricante duplicado',
  })
  @ApiParam({ name: 'homeId', description: 'UUID del hogar', format: 'uuid' })
  @ApiCreatedResponse({ description: 'Dispositivo creado en estado OFFLINE' })
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

  @Patch(':deviceId')
  @ApiOperation({
    summary: 'Actualizar la configuración de un dispositivo: OWNER',
  })
  @ApiParam({ name: 'homeId', description: 'UUID del hogar', format: 'uuid' })
  @ApiParam({
    name: 'deviceId',
    description: 'UUID del dispositivo',
    format: 'uuid',
  })
  @ApiOkResponse({ description: 'Dispositivo actualizado' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: UpdateDeviceDto,
  ) {
    return this.updateDeviceUseCase.execute({
      userId: user.userId,
      homeId,
      deviceId,
      deviceTypeId: dto.deviceTypeId,
      name: dto.name,
      transportType: dto.transportType,
      messagingProtocol: dto.messagingProtocol,
    });
  }

  @Patch(':deviceId/deactivate')
  @ApiOperation({
    summary: 'Desactivar un dispositivo de forma lógica: OWNER',
  })
  @ApiParam({ name: 'homeId', description: 'UUID del hogar', format: 'uuid' })
  @ApiParam({
    name: 'deviceId',
    description: 'UUID del dispositivo',
    format: 'uuid',
  })
  @ApiOkResponse({ description: 'Dispositivo desactivado lógicamente' })
  async deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    return this.deactivateDeviceUseCase.execute({
      userId: user.userId,
      homeId,
      deviceId,
    });
  }

  @Patch(':deviceId/control')
  @ApiOperation({
    summary: 'Enviar comando ON/OFF al dispositivo: OWNER',
  })
  @ApiParam({ name: 'homeId', description: 'UUID del hogar', format: 'uuid' })
  @ApiParam({
    name: 'deviceId',
    description: 'UUID del dispositivo',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Comando de control aceptado para publicación',
  })
  @ApiConflictResponse({
    description:
      'Dispositivo desconectado, no configurable o publicador MQTT no configurado',
  })
  async control(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: ControlDeviceDto,
  ) {
    return this.controlDeviceUseCase.execute({
      userId: user.userId,
      homeId,
      deviceId,
      command: dto.command,
    });
  }
}
