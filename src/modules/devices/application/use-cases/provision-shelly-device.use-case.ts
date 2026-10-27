import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { IdentifyShellyDeviceUseCase } from './identify-shelly-device.use-case';

import { CreateDeviceUseCase } from './create-device.use-case';

import { ShellyRpcClientService } from '../../infrastructure/shelly/shelly-rpc-client.service';
import { MqttRuntimeService } from '../../infrastructure/messaging/mqtt-runtime.service';

export interface ProvisionShellyDeviceInput {
  userId: string;

  homeId: string;

  shellyIp: string;

  name: string;
}

@Injectable()
export class ProvisionShellyDeviceUseCase {
  constructor(
    private readonly mqtt: MqttRuntimeService,
    private readonly configService: ConfigService,

    private readonly identifyShellyDeviceUseCase: IdentifyShellyDeviceUseCase,

    private readonly shellyRpcClient: ShellyRpcClientService,

    private readonly createDeviceUseCase: CreateDeviceUseCase,
  ) {}

  async execute(input: ProvisionShellyDeviceInput) {
    this.assertCloudCredentialProvisioningAvailable();
    // This legacy LAN flow shares the backend credential. Cloud bootstrap must
    // wait for individual device identities; never distribute the service secret.
    if (this.mqtt.config.tls || this.mqtt.config.namespace) {
      throw new ServiceUnavailableException({
        code: 'MQTT_DEVICE_BOOTSTRAP_REQUIRED',
        message:
          'El alta con TLS o namespace requiere credenciales MQTT individuales de dispositivo.',
      });
    }
    /*
     * 1. Identificamos nuevamente el
     * dispositivo antes de configurarlo.
     */
    const shelly = await this.identifyShellyDeviceUseCase.execute(
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
     * 3. Broker MQTT alcanzable por
     * el dispositivo físico.
     */
    const brokerServer = this.configService.get<string>(
      'MQTT_DEVICE_BROKER_SERVER',
    );

    if (!brokerServer) {
      throw new InternalServerErrorException(
        'MQTT_DEVICE_BROKER_SERVER no está configurado en el backend',
      );
    }

    const username =
      this.configService.get<string>('MQTT_USERNAME') || undefined;

    const password =
      this.configService.get<string>('MQTT_PASSWORD') || undefined;

    if (username && !password) {
      throw new InternalServerErrorException(
        'MQTT_USERNAME está configurado pero MQTT_PASSWORD no',
      );
    }

    /*
     * 4. Configuramos MQTT en el Shelly.
     */
    const mqttConfiguration = await this.shellyRpcClient.configureMqtt(
      input.shellyIp,
      {
        server: brokerServer,

        topicPrefix: shelly.manufacturerDeviceId,

        username,

        password,
      },
    );

    /*
     * 5. Reiniciamos cuando Shelly
     * indique que es necesario.
     */
    if (mqttConfiguration.restartRequired) {
      await this.shellyRpcClient.reboot(input.shellyIp);
    }

    /*
     * 6. Verificamos que MQTT quede
     * realmente conectado.
     */
    const mqttConnected = await this.shellyRpcClient.waitForMqttConnection(
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
     * - manufacturerDeviceId
     * - WIFI
     * - MQTT
     */
    const device = await this.createDeviceUseCase.execute({
      userId: input.userId,

      homeId: input.homeId,

      name: input.name,

      manufacturerDeviceId: shelly.manufacturerDeviceId,

      transportType: 'WIFI',

      messagingProtocol: 'MQTT',
    });

    return {
      message: 'Shelly configurado y vinculado correctamente',

      device,

      shelly: {
        ip: input.shellyIp,

        manufacturerDeviceId: shelly.manufacturerDeviceId,

        mac: shelly.mac,

        model: shelly.model,

        modelCode: shelly.modelCode,

        firmwareVersion: shelly.firmwareVersion,
      },

      mqtt: {
        server: brokerServer,

        topicPrefix: shelly.manufacturerDeviceId,

        connected: true,
      },
    };
  }

  private assertCloudCredentialProvisioningAvailable(): void {
    const runtimeEnvironment =
      this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
    const provider = this.configService
      .get<string>('MQTT_DEVICE_CREDENTIALS_PROVIDER')
      ?.trim()
      .toLowerCase();

    if (provider === 'emqx-serverless') {
      throw new ServiceUnavailableException({
        code: 'MQTT_DEVICE_IDENTITY_PROVIDER_UNSUPPORTED',
        message:
          'No está implementada la administración de credenciales individuales para EMQX Serverless; no se aprovisionó el dispositivo.',
      });
    }

    if (runtimeEnvironment === 'production') {
      throw new ServiceUnavailableException({
        code: 'MQTT_DEVICE_IDENTITY_PROVISIONING_UNAVAILABLE',
        message:
          'El aprovisionamiento productivo requiere credenciales MQTT individuales y verificación del cliente; este flujo local no las emite.',
      });
    }

    throw new ServiceUnavailableException({
      code: 'SHELLY_LEGACY_PROVISION_DISABLED',
      message:
        'El aprovisionamiento heredado está deshabilitado. ' +
        'Utiliza las sesiones de vinculación Shelly con ' +
        'credenciales MQTT individuales y autenticación verificada.',
    });
  }
}
