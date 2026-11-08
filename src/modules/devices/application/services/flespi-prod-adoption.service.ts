import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MqttRuntimeService } from '../../infrastructure/messaging/mqtt-runtime.service';
import { FlespiShellyStatusRpcClient } from '../../infrastructure/messaging/flespi-shelly-status-rpc.client';
import { ShellyPairingSessionService } from './shelly-pairing-session.service';
import { CreateDeviceUseCase } from '../use-cases/create-device.use-case';

/**
 * Temporary adoption of ONE preconfigured Flespi Shelly.
 * This does not mark a normal Mosquitto pairing session COMPLETED, provision
 * credentials or create mqtt_identity. Such guarantees require their own flow.
 */
@Injectable()
export class FlespiProdAdoptionService {
  constructor(
    private readonly mqtt: MqttRuntimeService,
    private readonly pairing: ShellyPairingSessionService,
    private readonly rpc: FlespiShellyStatusRpcClient,
    private readonly createDevice: CreateDeviceUseCase,
  ) {}

  async adopt(userId: string, homeId: string) {
    const config = this.mqtt.config;
    // Fail closed, including when this service is called outside its controller.
    if (
      !config.flespiProduction ||
      !config.flespiDeviceId ||
      !config.tls ||
      config.brokerUrl !== 'mqtts://mqtt.flespi.io:8883' ||
      process.env.FLESPI_MQTT_PROD_ADOPTION_ENABLED !== 'true' ||
      process.env.FLESPI_MQTT_PROD_HANDOFF_ACK !== 'true'
    ) {
      throw new ServiceUnavailableException({
        code: 'FLESPI_TEMP_ADOPTION_DISABLED',
        message: 'La adopción temporal Flespi no está habilitada.',
      });
    }

    // The existing RLS-backed check is stricter than merely trusting a JWT.
    // Never query the physical Shelly before checking the OWNER permission.
    await this.pairing.assertCanManageHome(userId, homeId);

    // A fresh nonce-correlated Switch.GetStatus RPC reply is required before
    // creating the record. It does not prove a unique broker-authenticated
    // physical identity and MUST NOT be confused with official MQTT pairing.
    try {
      const observed = await this.rpc.getSwitchStatus();
      if (
        !(observed.receivedAt instanceof Date) ||
        !Number.isFinite(observed.receivedAt.getTime()) ||
        Math.abs(Date.now() - observed.receivedAt.getTime()) > 15_000
      ) {
        throw new Error('STALE_FLESPI_RPC');
      }
    } catch {
      throw new ServiceUnavailableException({
        code: 'FLESPI_TEMP_DEVICE_NOT_VERIFIED',
        message: 'No se verificó una respuesta RPC reciente del Shelly.',
      });
    }

    // Reuse the OWNER/RLS-protected repository creation transaction.
    // The DB's unique manufacturer-device index rejects concurrent adoption
    // into a second home. New device starts OFFLINE until actual telemetry.
    const device = await this.createDevice.execute({
      userId,
      homeId,
      name: 'Luz',
      manufacturerDeviceId: config.flespiDeviceId,
      transportType: 'WIFI',
      messagingProtocol: 'MQTT',
    });

    return {
      ...device,
      integrationMode: 'FLESPI_TEMPORARY' as const,
      officialPairingCompleted: false,
    };
  }
}
