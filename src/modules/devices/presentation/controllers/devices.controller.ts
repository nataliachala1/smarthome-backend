import {
  Body,
  Controller,
  Delete,
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

import { ListInactiveDevicesUseCase } from '../../application/use-cases/list-inactive-devices.use-case';

import { CreateDeviceDto } from '../../application/dto/create-device.dto';

import { UpdateDeviceDto } from '../../application/dto/update-device.dto';

import { ControlDeviceDto } from '../../application/dto/control-device.dto';

import { CreateDeviceUseCase } from '../../application/use-cases/create-device.use-case';

import { GetDeviceByIdUseCase } from '../../application/use-cases/get-device-by-id.use-case';

import { UpdateDeviceUseCase } from '../../application/use-cases/update-device.use-case';

import { DeactivateDeviceUseCase } from '../../application/use-cases/deactivate-device.use-case';

import { ActivateDeviceUseCase } from '../../application/use-cases/activate-device.use-case';

import { DeleteDeviceUseCase } from '../../application/use-cases/delete-device.use-case';

import { ControlDeviceUseCase } from '../../application/use-cases/control-device.use-case';

@Controller('api/v1/homes/:homeId/devices')
@ApiTags('devices')
@ApiBearerAuth('access-token')
@ApiBadRequestResponse({
  description:
    'Invalid UUID or device data',
})
@ApiForbiddenResponse({
  description:
    'No active membership or insufficient role in the home',
})
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(
    private readonly listHomeDevicesUseCase:
      ListHomeDevicesUseCase,

    private readonly listInactiveDevicesUseCase:
      ListInactiveDevicesUseCase,

    private readonly createDeviceUseCase:
      CreateDeviceUseCase,

    private readonly getDeviceByIdUseCase:
      GetDeviceByIdUseCase,

    private readonly updateDeviceUseCase:
      UpdateDeviceUseCase,

    private readonly activateDeviceUseCase:
      ActivateDeviceUseCase,

    private readonly deactivateDeviceUseCase:
      DeactivateDeviceUseCase,

    private readonly deleteDeviceUseCase:
      DeleteDeviceUseCase,

    private readonly controlDeviceUseCase:
      ControlDeviceUseCase,
  ) {}

  // =========================================================
  // LIST ACTIVE DEVICES
  // =========================================================

  @Get()
  @ApiOperation({
    summary:
      'List the active devices of the home: OWNER, MEMBER or GUEST',
  })
  @ApiParam({
    name: 'homeId',
    description: 'Home UUID',
    format: 'uuid',
  })
  @ApiOkResponse({
    description:
      'List of active devices of the home',
  })
  async findAll(
    @CurrentUser()
    user: AuthenticatedUser,

    @Param(
      'homeId',
      ParseUUIDPipe,
    )
    homeId: string,
  ) {
    return this.listHomeDevicesUseCase.execute(
      user.userId,
      homeId,
    );
  }

  // =========================================================
  // LIST INACTIVE DEVICES
  // =========================================================
  //
  // IMPORTANT:
  // This route must be declared before @Get(':deviceId')
  // so that "inactive" is not interpreted as a UUID.
  // =========================================================

  @Get('inactive')
  @ApiOperation({
    summary:
      'List the inactive devices of the home: OWNER',
  })
  @ApiParam({
    name: 'homeId',
    description: 'Home UUID',
    format: 'uuid',
  })
  @ApiOkResponse({
    description:
      'List of inactive devices of the home',
  })
  async findInactive(
    @CurrentUser()
    user: AuthenticatedUser,

    @Param(
      'homeId',
      ParseUUIDPipe,
    )
    homeId: string,
  ) {
    return this.listInactiveDevicesUseCase.execute(
      user.userId,
      homeId,
    );
  }

  // =========================================================
  // GET DEVICE
  // =========================================================

  @Get(':deviceId')
  @ApiOperation({
    summary:
      'Get a device of the home by id',
  })
  @ApiParam({
    name: 'homeId',
    description: 'Home UUID',
    format: 'uuid',
  })
  @ApiParam({
    name: 'deviceId',
    description: 'Device UUID',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Authorized device',
  })
  async findById(
    @CurrentUser()
    user: AuthenticatedUser,

    @Param(
      'homeId',
      ParseUUIDPipe,
    )
    homeId: string,

    @Param(
      'deviceId',
      ParseUUIDPipe,
    )
    deviceId: string,
  ) {
    const device =
      await this.getDeviceByIdUseCase.execute(
        user.userId,
        homeId,
        deviceId,
      );

    if (!device) {
      throw new NotFoundException(
        'Dispositivo no encontrado',
      );
    }

    return device;
  }

  // =========================================================
  // CREATE DEVICE
  // =========================================================

  @Post()
  @ApiOperation({
    summary:
      'Register a device directly in the home: OWNER',
  })
  @ApiConflictResponse({
    description:
      'Duplicate active name or manufacturer identifier',
  })
  @ApiParam({
    name: 'homeId',
    description: 'Home UUID',
    format: 'uuid',
  })
  @ApiCreatedResponse({
    description:
      'Device created in OFFLINE state',
  })
  async create(
    @CurrentUser()
    user: AuthenticatedUser,

    @Param(
      'homeId',
      ParseUUIDPipe,
    )
    homeId: string,

    @Body()
    dto: CreateDeviceDto,
  ) {
    return this.createDeviceUseCase.execute({
      userId:
        user.userId,

      homeId,

      name:
        dto.name,

      manufacturerDeviceId:
        dto.manufacturerDeviceId,

      transportType:
        dto.transportType,

      messagingProtocol:
        dto.messagingProtocol,
    });
  }

  // =========================================================
  // UPDATE DEVICE
  // =========================================================

  @Patch(':deviceId')
  @ApiOperation({
    summary:
      'Update the configuration of a device: OWNER',
  })
  @ApiParam({
    name: 'homeId',
    description: 'Home UUID',
    format: 'uuid',
  })
  @ApiParam({
    name: 'deviceId',
    description: 'Device UUID',
    format: 'uuid',
  })
  @ApiOkResponse({
    description:
      'Device updated',
  })
  async update(
    @CurrentUser()
    user: AuthenticatedUser,

    @Param(
      'homeId',
      ParseUUIDPipe,
    )
    homeId: string,

    @Param(
      'deviceId',
      ParseUUIDPipe,
    )
    deviceId: string,

    @Body()
    dto: UpdateDeviceDto,
  ) {
    return this.updateDeviceUseCase.execute({
      userId:
        user.userId,

      homeId,

      deviceId,

      name:
        dto.name,

      transportType:
        dto.transportType,

      messagingProtocol:
        dto.messagingProtocol,
    });
  }

  // =========================================================
  // ACTIVATE DEVICE
  // =========================================================

  @Patch(':deviceId/activate')
  @ApiOperation({
    summary:
      'Reactivate an inactive device: OWNER',
  })
  @ApiParam({
    name: 'homeId',
    description: 'Home UUID',
    format: 'uuid',
  })
  @ApiParam({
    name: 'deviceId',
    description: 'Device UUID',
    format: 'uuid',
  })
  @ApiOkResponse({
    description:
      'Device activated successfully',
  })
  async activate(
    @CurrentUser()
    user: AuthenticatedUser,

    @Param(
      'homeId',
      ParseUUIDPipe,
    )
    homeId: string,

    @Param(
      'deviceId',
      ParseUUIDPipe,
    )
    deviceId: string,
  ) {
    return this.activateDeviceUseCase.execute({
      userId:
        user.userId,

      homeId,

      deviceId,
    });
  }

  // =========================================================
  // DEACTIVATE DEVICE
  // =========================================================

  @Patch(':deviceId/deactivate')
  @ApiOperation({
    summary:
      'Temporarily deactivate a device: OWNER',
  })
  @ApiParam({
    name: 'homeId',
    description: 'Home UUID',
    format: 'uuid',
  })
  @ApiParam({
    name: 'deviceId',
    description: 'Device UUID',
    format: 'uuid',
  })
  @ApiOkResponse({
    description:
      'Device deactivated successfully',
  })
  async deactivate(
    @CurrentUser()
    user: AuthenticatedUser,

    @Param(
      'homeId',
      ParseUUIDPipe,
    )
    homeId: string,

    @Param(
      'deviceId',
      ParseUUIDPipe,
    )
    deviceId: string,
  ) {
    return this.deactivateDeviceUseCase.execute({
      userId:
        user.userId,

      homeId,

      deviceId,
    });
  }

  // =========================================================
  // CONTROL ON / OFF
  // =========================================================

  @Patch(':deviceId/control')
  @ApiOperation({
    summary:
      'Send an ON/OFF command to the device: OWNER or MEMBER',
  })
  @ApiParam({
    name: 'homeId',
    description: 'Home UUID',
    format: 'uuid',
  })
  @ApiParam({
    name: 'deviceId',
    description: 'Device UUID',
    format: 'uuid',
  })
  @ApiOkResponse({
    description:
      'Control command accepted for publication',
  })
  @ApiConflictResponse({
    description:
      'Device disconnected, not configurable or MQTT publisher not configured',
  })
  async control(
    @CurrentUser()
    user: AuthenticatedUser,

    @Param(
      'homeId',
      ParseUUIDPipe,
    )
    homeId: string,

    @Param(
      'deviceId',
      ParseUUIDPipe,
    )
    deviceId: string,

    @Body()
    dto: ControlDeviceDto,
  ) {
    return this.controlDeviceUseCase.execute({
      userId:
        user.userId,

      homeId,

      deviceId,

      command:
        dto.command,
    });
  }

  // =========================================================
  // DELETE DEVICE
  // =========================================================
  //
  // The endpoint is DELETE, but internally a logical
  // deletion is performed through deleted_at.
  // =========================================================

  @Delete(':deviceId')
  @ApiOperation({
    summary:
      'Logically delete a device of the home: OWNER',
  })
  @ApiParam({
    name: 'homeId',
    description: 'Home UUID',
    format: 'uuid',
  })
  @ApiParam({
    name: 'deviceId',
    description: 'Device UUID',
    format: 'uuid',
  })
  @ApiOkResponse({
    description:
      'Dispositivo eliminado correctamente',
  })
  async delete(
    @CurrentUser()
    user: AuthenticatedUser,

    @Param(
      'homeId',
      ParseUUIDPipe,
    )
    homeId: string,

    @Param(
      'deviceId',
      ParseUUIDPipe,
    )
    deviceId: string,
  ) {
    return this.deleteDeviceUseCase.execute({
      userId:
        user.userId,

      homeId,

      deviceId,
    });
  }
}