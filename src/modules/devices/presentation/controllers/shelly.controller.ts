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
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../auth/presentation/http/guards/jwt-auth.guard';

import { CurrentUser } from '../../../auth/presentation/http/decorators/current-user.decorator';

import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';

import { IdentifyShellyDeviceDto } from '../../application/dto/identify-shelly-device.dto';
import { ShellyDeviceInfoResponseDto } from '../../application/dto/shelly-device-info-response.dto';
import { IdentifyShellyDeviceUseCase } from '../../application/use-cases/identify-shelly-device.use-case';
import { ProvisionShellyDeviceDto } from '../../application/dto/provision-shelly-device.dto';
import { ProvisionShellyDeviceUseCase } from '../../application/use-cases/provision-shelly-device.use-case';
import { DiscoverShellyDevicesUseCase } from '../../application/use-cases/discover-shelly-devices.use-case';
import { DiscoveredShellyDeviceDto } from '../../application/dto/discovered-shelly-device.dto';

@Controller('api/v1/homes/:homeId/shelly')
@ApiTags('shelly')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class ShellyController {
  constructor(
    private readonly identifyShellyDeviceUseCase:
      IdentifyShellyDeviceUseCase,

    private readonly provisionShellyDeviceUseCase:
      ProvisionShellyDeviceUseCase,

    private readonly discoverShellyDevicesUseCase:
      DiscoverShellyDevicesUseCase,
  ) {}

  @Get('discover')
  @ApiOperation({
    summary:
      'Buscar automáticamente Shelly 1PM Gen4 en la red local: OWNER',
  })
  @ApiParam({
    name: 'homeId',
    description: 'UUID del hogar',
    format: 'uuid',
  })
  @ApiOkResponse({
    description:
      'Dispositivos Shelly 1PM Gen4 encontrados en la red local',
    type: DiscoveredShellyDeviceDto,
    isArray: true,
  })
  @ApiForbiddenResponse({
    description:
      'El usuario no puede administrar el hogar',
  })
  async discover(
    @CurrentUser()
    user: AuthenticatedUser,

    @Param(
      'homeId',
      ParseUUIDPipe,
    )
    homeId: string,
  ): Promise<
    DiscoveredShellyDeviceDto[]
  > {
    return this.discoverShellyDevicesUseCase.execute(
      user.userId,
      homeId,
    );
  }

  @Post('identify')
  @ApiOperation({
    summary:
      'Identificar un Shelly 1PM Gen4 por IP local: OWNER',
  })
  @ApiParam({
    name: 'homeId',
    description: 'UUID del hogar',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Shelly identificado correctamente',
    type: ShellyDeviceInfoResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'IP o UUID inválido',
  })
  @ApiForbiddenResponse({
    description:
      'El usuario no puede administrar el hogar',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'El dispositivo encontrado no es un Shelly 1PM Gen4 compatible',
  })
  @ApiBadGatewayResponse({
    description:
      'El Shelly no responde o no es accesible',
  })
  async identify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Body() dto: IdentifyShellyDeviceDto,
  ): Promise<ShellyDeviceInfoResponseDto> {
    return this.identifyShellyDeviceUseCase.execute(
      user.userId,
      homeId,
      dto.shellyIp,
    );
  }

  @Post('provision')
  @ApiOperation({
    summary:
      'Configurar MQTT y registrar un Shelly 1PM Gen4 en el hogar: OWNER',
  })
  @ApiParam({
    name: 'homeId',
    description: 'UUID del hogar',
    format: 'uuid',
  })
  @ApiCreatedResponse({
    description:
      'Shelly configurado y registrado correctamente',
  })
  @ApiBadRequestResponse({
    description:
      'IP, UUID o datos inválidos',
  })
  @ApiForbiddenResponse({
    description:
      'El usuario no puede administrar el hogar',
  })
  @ApiConflictResponse({
    description:
      'El Shelly o el nombre del dispositivo ya están registrados',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Shelly incompatible o con autenticación local habilitada',
  })
  @ApiBadGatewayResponse({
    description:
      'No fue posible configurar el Shelly o conectarlo al broker MQTT',
  })
  async provision(
    @CurrentUser() user: AuthenticatedUser,

    @Param(
      'homeId',
      ParseUUIDPipe,
    )
    homeId: string,

    @Body()
    dto: ProvisionShellyDeviceDto,
  ) {
    return this.provisionShellyDeviceUseCase.execute(
      {
        userId: user.userId,

        homeId,

        shellyIp: dto.shellyIp,

        name: dto.name,
      },
    );
  }

}