import { Logger, type OnApplicationBootstrap, type OnModuleDestroy, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MqttRevocationLoop } from '../../application/services/mqtt-revocation.loop';
import { MqttRevocationWorker } from '../../application/services/mqtt-revocation.worker';
import { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';
import { ShellyMqttRevocationBroker } from './shelly-mqtt-revocation-broker';
import { MqttRevocationPgGateway, openMqttRevocationPgGateway } from '../persistence/mqtt-revocation-pg.gateway';
import { PgMqttRevocationPort } from '../persistence/pg-mqtt-revocation.port';
import { requireShellyMqttDeploymentMode } from './shelly-mqtt-deployment-mode';

const logger = new Logger('ShellyMqttRevocationLoop');

export class ShellyMqttRevocationLifecycle implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(private readonly loop: MqttRevocationLoop) {}

  onApplicationBootstrap(): void {
    this.loop.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.loop.stop();
  }
}

export const MQTT_REVOCATION_GATEWAY = Symbol('MQTT_REVOCATION_GATEWAY');

/** Only registered inside the strict VPS DEV pairing profile. */
export const shellyMqttVpsRevocationProviders: Provider[] = [
  {
    provide: MQTT_REVOCATION_GATEWAY,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => openMqttRevocationPgGateway(
      config.get<string>('MQTT_REVOCATION_DATABASE_URL'),
      requireShellyMqttDeploymentMode(),
    ),
  },
  {
    provide: PgMqttRevocationPort,
    inject: [MQTT_REVOCATION_GATEWAY],
    useFactory: (gateway: MqttRevocationPgGateway) => new PgMqttRevocationPort(gateway),
  },
  {
    provide: ShellyMqttRevocationBroker,
    inject: [MqttDeviceIdentityProvider],
    useFactory: (broker: MqttDeviceIdentityProvider) =>
      new ShellyMqttRevocationBroker(broker),
  },
  {
    provide: MqttRevocationWorker,
    inject: [PgMqttRevocationPort, ShellyMqttRevocationBroker],
    useFactory: (
      port: PgMqttRevocationPort,
      broker: ShellyMqttRevocationBroker,
    ) => new MqttRevocationWorker(port, broker),
  },
  {
    provide: MqttRevocationLoop,
    inject: [MqttRevocationWorker],
    useFactory: (worker: MqttRevocationWorker) => new MqttRevocationLoop(
      () => worker.runOnce(),
      5000,
      (event) => {
        if (event !== 'IDLE') logger.warn(event);
      },
    ),
  },
  {
    provide: ShellyMqttRevocationLifecycle,
    inject: [MqttRevocationLoop],
    useFactory: (loop: MqttRevocationLoop) => new ShellyMqttRevocationLifecycle(loop),
  },
];
