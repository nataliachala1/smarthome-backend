import { ServiceUnavailableException } from '@nestjs/common';
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));
jest.mock('./identify-shelly-device.use-case', () => ({
  IdentifyShellyDeviceUseCase: class IdentifyShellyDeviceUseCase {},
}));
jest.mock('./create-device.use-case', () => ({
  CreateDeviceUseCase: class CreateDeviceUseCase {},
}));
jest.mock('../../infrastructure/shelly/shelly-rpc-client.service', () => ({
  ShellyRpcClientService: class ShellyRpcClientService {},
}));
import { ProvisionShellyDeviceUseCase } from './provision-shelly-device.use-case';

describe('ProvisionShellyDeviceUseCase production safety', () => {
  const input = {
    userId: 'user-id',
    homeId: 'home-id',
    shellyIp: '192.168.1.10',
    name: 'Test Shelly',
  };

  it('refuses production provisioning before contacting the Shelly or broker', async () => {
    const identify = { execute: jest.fn() };
    const rpc = { configureMqtt: jest.fn() };
    const createDevice = { execute: jest.fn() };
    const config = {
      get: jest.fn((key: string) =>
        key === 'NODE_ENV' ? 'production' : undefined,
      ),
    };
    const useCase = new ProvisionShellyDeviceUseCase(
      {} as never,
      config as never,
      identify as never,
      rpc as never,
      createDevice as never,
    );

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(identify.execute).not.toHaveBeenCalled();
    expect(rpc.configureMqtt).not.toHaveBeenCalled();
    expect(createDevice.execute).not.toHaveBeenCalled();
  });

  it('refuses an unimplemented EMQX Serverless identity adapter in any environment', async () => {
    const identify = { execute: jest.fn() };
    const config = {
      get: jest.fn((key: string) =>
        key === 'MQTT_DEVICE_CREDENTIALS_PROVIDER' ? 'emqx-serverless' : 'test',
      ),
    };
    const useCase = new ProvisionShellyDeviceUseCase(
      {} as never,
      config as never,
      identify as never,
      { configureMqtt: jest.fn() } as never,
      { execute: jest.fn() } as never,
    );

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(identify.execute).not.toHaveBeenCalled();
  });
});
