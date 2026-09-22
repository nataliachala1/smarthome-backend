import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { IdentifyShellyDeviceUseCase } from './identify-shelly-device.use-case';

import { CreateDeviceUseCase } from './create-device.use-case';

import { ShellyRpcClientService } from '../../infrastructure/shelly/shelly-rpc-client.service';

import { DeviceTypeRepository } from '../../domain/repositories/device-type.repository';

export interface ProvisionShellyDeviceInput {
  userId: string;

  homeId: string;

  shellyIp: string;

  name: string;
}

@Injectable()
export class ProvisionShellyDeviceUseCase {
  constructor(
    private readonly configService:
      ConfigService,

    private readonly identifyShellyDeviceUseCase:
      IdentifyShellyDeviceUseCase,

    private readonly shellyRpcClient:
      ShellyRpcClientService,

    private readonly createDeviceUseCase:
      CreateDeviceUseCase,

    private readonly deviceTypeRepository:
      DeviceTypeRepository,
  ) {}

  async execute(
    input: ProvisionShellyDeviceInput,
  ) {
    /*
     * 1. Identificamos nuevamente el
     * dispositivo antes de configurarlo.
     */
    const shelly =
      await this.identifyShellyDeviceUseCase.execute(
        input.userId,
        input.homeId,
        input.shellyIp,
      );

    if (
      shelly.authenticationRequired
    ) {
      throw new UnprocessableEntityException(
        'El Shelly tiene autenticación habilitada. La primera versión del provisionamiento requiere que la autenticación local del dispositivo esté deshabilitada.',
      );
    }

    /*
     * 2. El tipo de dispositivo es un
     * detalle interno.
     *
     * El usuario NO debe seleccionarlo.
     *
     * Shelly 1PM puede controlar diferentes
     * tipos de carga, por eso inicialmente
     * utilizamos la categoría genérica "Otro".
     */
    const deviceType =
      await this.deviceTypeRepository.findByName(
        'Otro',
      );

    if (!deviceType) {
      throw new InternalServerErrorException(
        'No existe el tipo interno de dispositivo "Otro"',
      );
    }

    /*
     * 3. Broker MQTT alcanzable por
     * el dispositivo físico.
     */
    const brokerServer =
      this.configService.get<string>(
        'MQTT_DEVICE_BROKER_SERVER',
      );

    if (!brokerServer) {
      throw new InternalServerErrorException(
        'MQTT_DEVICE_BROKER_SERVER no está configurado en el backend',
      );
    }

    const username =
      this.configService.get<string>(
        'MQTT_USERNAME',
      ) || undefined;

    const password =
      this.configService.get<string>(
        'MQTT_PASSWORD',
      ) || undefined;

    if (
      username &&
      !password
    ) {
      throw new InternalServerErrorException(
        'MQTT_USERNAME está configurado pero MQTT_PASSWORD no',
      );
    }

    /*
     * 4. Configuramos MQTT en el Shelly.
     */
    const mqttConfiguration =
      await this.shellyRpcClient.configureMqtt(
        input.shellyIp,
        {
          server:
            brokerServer,

          topicPrefix:
            shelly.manufacturerDeviceId,

          username,

          password,
        },
      );

    /*
     * 5. Reiniciamos cuando Shelly
     * indique que es necesario.
     */
    if (
      mqttConfiguration.restartRequired
    ) {
      await this.shellyRpcClient.reboot(
        input.shellyIp,
      );
    }

    /*
     * 6. Verificamos que MQTT quede
     * realmente conectado.
     */
    const mqttConnected =
      await this.shellyRpcClient.waitForMqttConnection(
        input.shellyIp,
      );

    if (!mqttConnected) {
      throw new BadGatewayException(
        'El Shelly fue configurado, pero no logró conectarse al broker MQTT',
      );
    }

    /*
     * 7. Registramos el dispositivo
     * en SmartHome.
     *
     * El frontend no necesita conocer:
     * - deviceTypeId
     * - manufacturerDeviceId
     * - WIFI
     * - MQTT
     */
    const device =
      await this.createDeviceUseCase.execute({
        userId:
          input.userId,

        homeId:
          input.homeId,

        deviceTypeId:
          deviceType.id,

        name:
          input.name,

        manufacturerDeviceId:
          shelly.manufacturerDeviceId,

        transportType:
          'WIFI',

        messagingProtocol:
          'MQTT',
      });

    return {
      message:
        'Shelly configurado y vinculado correctamente',

      device,

      shelly: {
        ip:
          input.shellyIp,

        manufacturerDeviceId:
          shelly.manufacturerDeviceId,

        mac:
          shelly.mac,

        model:
          shelly.model,

        modelCode:
          shelly.modelCode,

        firmwareVersion:
          shelly.firmwareVersion,
      },

      mqtt: {
        server:
          brokerServer,

        topicPrefix:
          shelly.manufacturerDeviceId,

        connected:
          true,
      },
    };
  }
}