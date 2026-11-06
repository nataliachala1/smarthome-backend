jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
}));

import { MqttDeviceControlPublisher } from './mqtt-device-control.publisher';
import type { MqttRuntimeService } from './mqtt-runtime.service';

const deviceId = 'shelly1pmg4-d885acf06990';
const mk = (canControl: boolean) => new MqttDeviceControlPublisher({
  config: {
    flespiProduction: true,
    flespiControlEnabled: canControl,
    flespiDeviceId: deviceId,
  },
  topics: { control: jest.fn() },
} as unknown as MqttRuntimeService);

describe('Flespi PROD command cutover', () => {
  const input = {
    manufacturerDeviceId: deviceId,
    homeId: 'synthetic-home',
    deviceId: 'synthetic-device',
    action: 'TURN_ON' as const,
  };
  it('cannot publish when disabled', async () => {
    await expect(mk(false).publishControlCommand(input)).rejects.toThrow();
  });
  it('cannot control any other physical device', async () => {
    await expect(mk(true).publishControlCommand({
      ...input, manufacturerDeviceId: 'shelly-other',
    })).rejects.toThrow();
  });
});
