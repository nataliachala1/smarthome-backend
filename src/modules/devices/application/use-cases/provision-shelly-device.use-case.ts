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

export interface ProvisionShellyDeviceInput {
  userId: string;

  homeId: string;

  shellyIp: string;

  name: string;

  deviceTypeId: string;
}

@Injectable()
export class ProvisionShellyDeviceUseCase {
  constructor(
    private readonly configService: ConfigService,

    private readonly identifyShellyDeviceUseCase:
      IdentifyShellyDeviceUseCase,

    private readonly shellyRpcClient:
      ShellyRpcClientService,

    private readonly createDeviceUseCase:
      CreateDeviceUseCase,
  ) {}

  async execute(
    input: ProvisionShellyDeviceInput,
  ) {
    /*
     * 1. Volvemos a identificar.
     *
     * Esto también valida:
     * - usuario
     * - hogar
     * - permisos
     * - IP privada
     * - modelo Shelly 1PM Gen4
     */
    const shelly =
      await this.identifyShellyDeviceUseCase.execute(
        input.userId,
        input.homeId,
        input.shellyIp,
      );

    if (shelly.authenticationRequired) {
      throw new UnprocessableEntityException(
        'El Shelly tiene autenticación habilitada. La primera versión del provisionamiento requiere que la autenticación local del dispositivo esté deshabilitada.',
      );
    }

    /*
     * IMPORTANTE:
     *
     * No podemos enviar localhost al Shelly.
     * La dirección debe poder ser alcanzada desde
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

    if (username && !password) {
      throw new InternalServerErrorException(
        'MQTT_USERNAME está configurado pero MQTT_PASSWORD no',
      );
    }

    /*
     * 2. Configuramos MQTT.
     *
     * Dejamos manufacturerDeviceId como topic_prefix
     * porque todo el backend ya trabaja con ese ID.
     */
    const mqttConfiguration =
      await this.shellyRpcClient.configureMqtt(
        input.shellyIp,
        {
          server: brokerServer,

          topicPrefix:
            shelly.manufacturerDeviceId,

          username,

          password,
        },
      );

    /*
     * 3. Aplicamos configuración.
     */
    if (mqttConfiguration.restartRequired) {
      await this.shellyRpcClient.reboot(
        input.shellyIp,
      );
    }

    /*
     * 4. Esperamos a que MQTT quede realmente
     * conectado antes de registrar el dispositivo.
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
     * 5. Solo cuando MQTT funciona registramos el
     * dispositivo en SmartHome.
     */
    const device =
      await this.createDeviceUseCase.execute({
        userId: input.userId,

        homeId: input.homeId,

        deviceTypeId: input.deviceTypeId,

        name: input.name,

        manufacturerDeviceId:
          shelly.manufacturerDeviceId,

        transportType: 'WIFI',

        messagingProtocol: 'MQTT',
      });

    return {
      message:
        'Shelly configurado y registrado correctamente',

      device,

      shelly: {
        ip: input.shellyIp,

        manufacturerDeviceId:
          shelly.manufacturerDeviceId,

        mac: shelly.mac,

        model: shelly.model,

        modelCode: shelly.modelCode,

        firmwareVersion:
          shelly.firmwareVersion,
      },

      mqtt: {
        server: brokerServer,

        topicPrefix:
          shelly.manufacturerDeviceId,

        connected: true,
      },
    };
  }
}