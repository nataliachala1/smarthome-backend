import {
  Body,
  Delete,
  Controller,
  Get,
  HttpCode,
  Headers,
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
  ApiHeader,
  ApiParam,
  ApiServiceUnavailableResponse,
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
import { CreateShellyPairingSessionDto } from '../../application/dto/create-shelly-pairing-session.dto';
import { ReportShellyPairingIdentityDto } from '../../application/dto/report-shelly-pairing-identity.dto';
import { CompleteShellyPairingSessionDto } from '../../application/dto/complete-shelly-pairing-session.dto';
import { ShellyPairingSessionService } from '../../application/services/shelly-pairing-session.service';

@Controller('api/v1/homes/:homeId/shelly')
@ApiTags('shelly')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
export class ShellyController {
  constructor(
    private readonly identifyShellyDeviceUseCase: IdentifyShellyDeviceUseCase,

    private readonly provisionShellyDeviceUseCase: ProvisionShellyDeviceUseCase,

    private readonly discoverShellyDevicesUseCase: DiscoverShellyDevicesUseCase,

    private readonly pairingSessionService: ShellyPairingSessionService,
  ) {}

  @Get('setup-capabilities')
  @ApiOperation({
    summary: 'Consultar capacidades disponibles para alta Shelly por red local',
  })
  @ApiOkResponse({
    description:
      'AP es prioritario; la configuración local la ejecuta Android. La prueba física sigue pendiente.',
  })
  async setupCapabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
  ) {
    await this.pairingSessionService.assertCanManageHome(user.userId, homeId);
    return {
      preferredMethod: 'AP',
      compatibleModels: [
        {
          modelCode: 'S4SW-001P16EU',
          generation: 4,
          firmwareCompatibility: 'NOT_CONFIGURED',
        },
      ],
      methods: {
        AP: {
          sessionCoordination: 'READY_FOR_SESSION_CREATION',
          deviceConfiguration: 'MOBILE_TO_DEVICE_LOCAL_REQUIRED',
          physicalValidation: 'POC_PENDING',
          localRpcBaseUrl: 'http://192.168.33.1',
        },
        BLE: {
          sessionCoordination: 'NOT_AVAILABLE',
          reason: 'BLE automatizado requiere POC nativa y validación física.',
        },
      },
      brokerCredentialProvisioning: {
        status: 'BLOCKED_UNTIL_INDIVIDUAL_AUTHENTICATION_VALIDATED',
        reason:
          'No se ha validado una API soportada de EMQX Serverless para crear credenciales y ACL individuales desde el backend.',
      },
      pairingCompletion:
        'BLOCKED_UNTIL_DEVICE_SPECIFIC_AUTHENTICATED_CONNECTION',
      completionRequires:
        'BROKER_OBSERVED_DEVICE_SPECIFIC_AUTHENTICATED_MQTT_CONNECTION',
    };
  }

  @Post('setup-sessions')
  @ApiOperation({ summary: 'Iniciar sesión temporal de pairing para OWNER' })
  @ApiCreatedResponse({
    description: 'Sesión PENDING creada; el token de sesión no se devuelve.',
  })
  async createSetupSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Body() dto: CreateShellyPairingSessionDto,
  ) {
    return this.pairingSessionService.create(user.userId, homeId, dto);
  }

  @Get('setup-sessions/:sessionId')
  @ApiOperation({ summary: 'Consultar sesión de pairing' })
  @ApiHeader({ name: 'X-Pairing-Token', required: true })
  async getSetupSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Headers('x-pairing-token') token: string,
  ) {
    return this.pairingSessionService.get(
      user.userId,
      homeId,
      sessionId,
      token ?? '',
    );
  }

  @Post('setup-sessions/:sessionId/identify')
  @ApiOperation({
    summary:
      'Guardar identidad reportada por el móvil; no completa ni verifica posesión',
  })
  @ApiHeader({ name: 'X-Pairing-Token', required: true })
  async reportSetupIdentity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Headers('x-pairing-token') token: string,
    @Body() dto: ReportShellyPairingIdentityDto,
  ) {
    return this.pairingSessionService.reportIdentity(
      user.userId,
      homeId,
      sessionId,
      token ?? '',
      dto,
    );
  }

  @Delete('setup-sessions/:sessionId')
  @ApiOperation({ summary: 'Cancelar sesión de pairing activa' })
  @ApiHeader({ name: 'X-Pairing-Token', required: true })
  async cancelSetupSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Headers('x-pairing-token') token: string,
  ) {
    return this.pairingSessionService.cancel(
      user.userId,
      homeId,
      sessionId,
      token ?? '',
    );
  }

  @Post('setup-sessions/:sessionId/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Completar el registro solo tras confirmar MQTT autenticado',
  })
  @ApiHeader({ name: 'X-Pairing-Token', required: true })
  @ApiOkResponse({
    description: 'Sesión completada o aún esperando verificación MQTT.',
  })
  @ApiConflictResponse({
    description: 'La sesión no está lista o el dispositivo ya está registrado.',
  })
  async completeSetupSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('homeId', ParseUUIDPipe) homeId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Headers('x-pairing-token') token: string,
    @Body() dto: CompleteShellyPairingSessionDto,
  ) {
    return this.pairingSessionService.complete(
      user.userId,
      homeId,
      sessionId,
      token ?? '',
      dto.name,
    );
  }

  @Get('discover')
  @ApiOperation({
    summary: 'Buscar automáticamente Shelly 1PM Gen4 en la red local: OWNER',
  })
  @ApiParam({
    name: 'homeId',
    description: 'UUID del hogar',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Dispositivos Shelly 1PM Gen4 encontrados en la red local',
    type: DiscoveredShellyDeviceDto,
    isArray: true,
  })
  @ApiForbiddenResponse({
    description: 'El usuario no puede administrar el hogar',
  })
  async discover(
    @CurrentUser()
    user: AuthenticatedUser,

    @Param('homeId', ParseUUIDPipe)
    homeId: string,
  ): Promise<DiscoveredShellyDeviceDto[]> {
    return this.discoverShellyDevicesUseCase.execute(user.userId, homeId);
  }

  @Post('identify')
  @ApiOperation({
    summary: 'Identificar un Shelly 1PM Gen4 por IP local: OWNER',
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
    description: 'El usuario no puede administrar el hogar',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'El dispositivo encontrado no es un Shelly 1PM Gen4 compatible',
  })
  @ApiBadGatewayResponse({
    description: 'El Shelly no responde o no es accesible',
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
  @ApiServiceUnavailableResponse({
    description:
      'MQTT_DEVICE_BOOTSTRAP_REQUIRED: TLS o namespace requieren alta con identidad individual; el flujo LAN heredado no entrega credenciales de servicio.',
  })
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
    description: 'Shelly configurado y registrado correctamente',
  })
  @ApiBadRequestResponse({
    description: 'IP, UUID o datos inválidos',
  })
  @ApiForbiddenResponse({
    description: 'El usuario no puede administrar el hogar',
  })
  @ApiConflictResponse({
    description: 'El Shelly o el nombre del dispositivo ya están registrados',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Shelly incompatible o con autenticación local habilitada',
  })
  @ApiBadGatewayResponse({
    description:
      'No fue posible configurar el Shelly o conectarlo al broker MQTT',
  })
  async provision(
    @CurrentUser() user: AuthenticatedUser,

    @Param('homeId', ParseUUIDPipe)
    homeId: string,

    @Body()
    dto: ProvisionShellyDeviceDto,
  ) {
    return this.provisionShellyDeviceUseCase.execute({
      userId: user.userId,

      homeId,

      shellyIp: dto.shellyIp,

      name: dto.name,
    });
  }
}
