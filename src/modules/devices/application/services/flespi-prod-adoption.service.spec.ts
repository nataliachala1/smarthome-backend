jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
}));

// Evita cargar Prisma real durante las pruebas unitarias.
// El servicio de adopción recibe un mock de esta dependencia.
jest.mock('./shelly-pairing-session.service', () => ({
  ShellyPairingSessionService: class ShellyPairingSessionService {},
}));

import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { FlespiProdAdoptionService } from './flespi-prod-adoption.service';
import type { MqttRuntimeService } from '../../infrastructure/messaging/mqtt-runtime.service';
import type { FlespiShellyStatusRpcClient } from '../../infrastructure/messaging/flespi-shelly-status-rpc.client';
import type { ShellyPairingSessionService } from './shelly-pairing-session.service';
import type { CreateDeviceUseCase } from '../use-cases/create-device.use-case';

const deviceId = 'shelly1pmg4-d885acf06990';
const previousAdoption = process.env.FLESPI_MQTT_PROD_ADOPTION_ENABLED;
const previousHandoff = process.env.FLESPI_MQTT_PROD_HANDOFF_ACK;

function setup(overrides: Record<string, unknown> = {}) {
  const mqtt = {
    config: {
      flespiProduction: true,
      flespiDeviceId: deviceId,
      brokerUrl: 'mqtts://mqtt.flespi.io:8883',
      tls: true,
      ...overrides,
    },
  } as unknown as MqttRuntimeService;
  const pairing = {
    assertCanManageHome: jest.fn().mockResolvedValue(undefined),
  };
  const rpc = {
    getSwitchStatus: jest.fn().mockResolvedValue({
      output: false,
      receivedAt: new Date(),
    }),
  };
  const createDevice = {
    execute: jest.fn().mockResolvedValue({
      id: 'new-device-id', homeId: 'home-id', name: 'Luz',
      connectivityStatus: 'OFFLINE',
    }),
  };
  const service = new FlespiProdAdoptionService(
    mqtt,
    pairing as unknown as ShellyPairingSessionService,
    rpc as unknown as FlespiShellyStatusRpcClient,
    createDevice as unknown as CreateDeviceUseCase,
  );
  return { service, pairing, rpc, createDevice };
}

describe('Temporary Flespi PROD adoption (never official pairing)', () => {
  beforeEach(() => {
    process.env.FLESPI_MQTT_PROD_ADOPTION_ENABLED = 'true';
    process.env.FLESPI_MQTT_PROD_HANDOFF_ACK = 'true';
  });
  afterAll(() => {
    if (previousAdoption === undefined) delete process.env.FLESPI_MQTT_PROD_ADOPTION_ENABLED;
    else process.env.FLESPI_MQTT_PROD_ADOPTION_ENABLED = previousAdoption;
    if (previousHandoff === undefined) delete process.env.FLESPI_MQTT_PROD_HANDOFF_ACK;
    else process.env.FLESPI_MQTT_PROD_HANDOFF_ACK = previousHandoff;
  });

  it('fails closed without explicit adoption flag', async () => {
    delete process.env.FLESPI_MQTT_PROD_ADOPTION_ENABLED;
    const { service, pairing, rpc, createDevice } = setup();
    await expect(service.adopt('owner', 'home-id')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(pairing.assertCanManageHome).not.toHaveBeenCalled();
    expect(rpc.getSwitchStatus).not.toHaveBeenCalled();
    expect(createDevice.execute).not.toHaveBeenCalled();
  });

  it('requires an acknowledged DEV handoff', async () => {
    process.env.FLESPI_MQTT_PROD_HANDOFF_ACK = 'false';
    const { service, rpc } = setup();
    await expect(service.adopt('owner', 'home-id')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(rpc.getSwitchStatus).not.toHaveBeenCalled();
  });

  it('rejects unauthorized member before contacting broker', async () => {
    const { service, pairing, rpc, createDevice } = setup();
    pairing.assertCanManageHome.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.adopt('guest', 'home-id')).rejects.toBeInstanceOf(ForbiddenException);
    expect(rpc.getSwitchStatus).not.toHaveBeenCalled();
    expect(createDevice.execute).not.toHaveBeenCalled();
  });

  it('does not insert when the Shelly does not answer the RPC challenge', async () => {
    const { service, rpc, createDevice } = setup();
    rpc.getSwitchStatus.mockRejectedValueOnce(new Error('MQTT timeout'));
    await expect(service.adopt('owner', 'home-id')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(createDevice.execute).not.toHaveBeenCalled();
  });

  it('does not insert from a stale RPC observation', async () => {
    const { service, rpc, createDevice } = setup();
    rpc.getSwitchStatus.mockResolvedValueOnce({output: false, receivedAt: new Date(0)});
    await expect(service.adopt('owner', 'home-id')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(createDevice.execute).not.toHaveBeenCalled();
  });

  it('reuses OWNER-protected creation, scoped to the configured device and home', async () => {
    const { service, pairing, rpc, createDevice } = setup();
    const result = await service.adopt('owner-uuid', 'home-uuid');
    expect(pairing.assertCanManageHome).toHaveBeenCalledWith('owner-uuid', 'home-uuid');
    expect(rpc.getSwitchStatus).toHaveBeenCalledTimes(1);
    expect(createDevice.execute).toHaveBeenCalledWith({
      userId: 'owner-uuid',
      homeId: 'home-uuid',
      name: 'Luz',
      manufacturerDeviceId: deviceId,
      transportType: 'WIFI',
      messagingProtocol: 'MQTT',
    });
    expect(result).toMatchObject({
      name: 'Luz',
      connectivityStatus: 'OFFLINE',
      integrationMode: 'FLESPI_TEMPORARY',
      officialPairingCompleted: false,
    });
  });

  it('does not weaken the existing unique-device conflict handling', async () => {
    const { service, createDevice } = setup();
    createDevice.execute.mockRejectedValueOnce(new Error('duplicate-device'));
    await expect(service.adopt('owner', 'home-id')).rejects.toThrow('duplicate-device');
    expect(createDevice.execute).toHaveBeenCalledTimes(1);
  });
});
