import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MQTT_SETTINGS } from '../../../../config/mqtt-config';
import { PrismaIotService } from '../../../../infrastructure/database/prisma/prisma-iot.service';
import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';
import { RealtimeEventsService } from '../../../realtime/realtime-events.service';
import {
  DeviceControlPublisher,
  PublishDeviceControlCommandInput,
} from '../../domain/services/device-control-publisher';
import { FlespiShellyStateReconciler } from './flespi-shelly-state.reconciler';
import { FlespiShellyStateSyncWorker } from './flespi-shelly-state-sync.worker';
import { FlespiShellyStatusRpcClient } from './flespi-shelly-status-rpc.client';
import { MqttDeviceControlPublisher } from './mqtt-device-control.publisher';
import { MqttDeviceStatusSubscriber } from './mqtt-device-status.subscriber';
import { MqttRuntimeService } from './mqtt-runtime.service';

// These independent instances never replace the existing Mosquitto runtime.
export const FLESPI_MQTT_RUNTIME = Symbol('FLESPI_MQTT_RUNTIME');
export const FLESPI_MQTT_STATUS = Symbol('FLESPI_MQTT_STATUS');
export const FLESPI_MQTT_CONTROL = Symbol('FLESPI_MQTT_CONTROL');
export const FLESPI_MQTT_RPC = Symbol('FLESPI_MQTT_RPC');
export const FLESPI_MQTT_RECONCILER = Symbol('FLESPI_MQTT_RECONCILER');
export const FLESPI_MQTT_WORKER = Symbol('FLESPI_MQTT_WORKER');

/**
 * Reuse the existing strict parser, MQTT TLS client, ACL topic contract,
 * SQL035/036 dedup and PostgreSQL ingest pipeline for one Shelly in DEV.
 * Do not reuse Mosquitto's password, private CA or administrative identity.
 */
export function createFlespiMqttRuntime(config: ConfigService): MqttRuntimeService {
  const values: Record<string, unknown> = {};
  for (const key of MQTT_SETTINGS) values[key] = config.get<unknown>(key);
  Object.assign(values, {
    MQTT_BROKER_PROVIDER: 'flespi',
    MQTT_BROKER_URL: 'mqtts://mqtt.flespi.io:8883',
    SHELLY_MQTT_VPS_DEV_BROKER_HOST: 'mqtt.flespi.io',
    MQTT_FLESPI_DEVICE_ID: config.get<string>('FLESPI_MQTT_DEVICE_ID'),
    MQTT_USERNAME: config.get<string>('FLESPI_MQTT_BACKEND_TOKEN'),
    MQTT_PASSWORD: undefined,
    MQTT_TLS_CA_FILE: undefined,
    MQTT_CLIENT_ID: undefined,
    MQTT_STATUS_CLIENT_ID: undefined,
    MQTT_CONTROL_TOPIC_PREFIX: undefined,
    MQTT_STATUS_TOPIC_FILTER: undefined,
    MQTT_SHELLY_SWITCH_TOPIC_FILTER: undefined,
    MQTT_SHELLY_RPC_EVENTS_TOPIC_FILTER: undefined,
    MQTT_SHELLY_RPC_SOURCE: undefined,
    MQTT_SHELLY_SWITCH_ID: '0',
  });
  // ConfigService adapter keeps MqttRuntimeService's existing validation.
  return new MqttRuntimeService({
    get: (key: string): unknown => values[key],
  } as ConfigService);
}

/** Route ONLY the explicitly allowlisted Shelly to flespi. */
export class RoutedMqttDeviceControlPublisher extends DeviceControlPublisher {
  constructor(
    private readonly mosquitto: MqttDeviceControlPublisher,
    private readonly flespi: MqttDeviceControlPublisher,
    private readonly flespiDeviceId: string,
  ) {
    super();
  }

  publishControlCommand(input: PublishDeviceControlCommandInput): Promise<void> {
    const target = input.manufacturerDeviceId === this.flespiDeviceId
      ? this.flespi : this.mosquitto;
    return target.publishControlCommand(input);
  }
}

export const flespiMqttParallelProviders: Provider[] = [
  {
    provide: FLESPI_MQTT_RUNTIME,
    inject: [ConfigService],
    useFactory: createFlespiMqttRuntime,
  },
  {
    provide: FLESPI_MQTT_STATUS,
    inject: [FLESPI_MQTT_RUNTIME, PrismaIotService, PrismaRlsService, RealtimeEventsService],
    useFactory: (
      runtime: MqttRuntimeService,
      iot: PrismaIotService,
      rls: PrismaRlsService,
      realtime: RealtimeEventsService,
    ) => new MqttDeviceStatusSubscriber(runtime, iot, rls, realtime),
  },
  {
    provide: FLESPI_MQTT_CONTROL,
    inject: [FLESPI_MQTT_RUNTIME],
    useFactory: (runtime: MqttRuntimeService) => new MqttDeviceControlPublisher(runtime),
  },
  {
    provide: FLESPI_MQTT_RPC,
    inject: [FLESPI_MQTT_RUNTIME],
    useFactory: (runtime: MqttRuntimeService) => new FlespiShellyStatusRpcClient(runtime),
  },
  {
    provide: FLESPI_MQTT_RECONCILER,
    inject: [FLESPI_MQTT_RUNTIME, FLESPI_MQTT_RPC, PrismaIotService, RealtimeEventsService],
    useFactory: (
      runtime: MqttRuntimeService,
      rpc: FlespiShellyStatusRpcClient,
      iot: PrismaIotService,
      realtime: RealtimeEventsService,
    ) => new FlespiShellyStateReconciler(runtime, rpc, iot, realtime),
  },
  ...(process.env.SHELLY_FLESPI_STATE_SYNC_ENABLED === 'true'
    ? [{
      provide: FLESPI_MQTT_WORKER,
      inject: [FLESPI_MQTT_RUNTIME, FLESPI_MQTT_RECONCILER],
      useFactory: (runtime: MqttRuntimeService, reconciler: FlespiShellyStateReconciler) =>
        new FlespiShellyStateSyncWorker(runtime, reconciler),
    }]
    : []),
];
