jest.mock('../../infrastructure/messaging/shelly-mqtt-deployment-mode', () => ({
  selectShellyMqttProviderPlan: jest.fn(),
}));
jest.mock('../../../auth/presentation/http/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuardMock {},
}));
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));
jest.mock('../../application/use-cases/identify-shelly-device.use-case', () => ({
  IdentifyShellyDeviceUseCase: class IdentifyShellyDeviceUseCase {},
}));
jest.mock('../../application/use-cases/provision-shelly-device.use-case', () => ({
  ProvisionShellyDeviceUseCase: class ProvisionShellyDeviceUseCase {},
}));
jest.mock('../../application/use-cases/discover-shelly-devices.use-case', () => ({
  DiscoverShellyDevicesUseCase: class DiscoverShellyDevicesUseCase {},
}));
jest.mock('../../application/services/shelly-pairing-session.service', () => ({
  ShellyPairingSessionService: class ShellyPairingSessionService {},
}));

import { ShellyController } from './shelly.controller';
import { selectShellyMqttProviderPlan } from '../../infrastructure/messaging/shelly-mqtt-deployment-mode';

const selectPlan = selectShellyMqttProviderPlan as jest.MockedFunction<
  typeof selectShellyMqttProviderPlan
>;

const enabledPlan = {
  mode: 'production-mosquitto' as const,
  localWorkflow: false,
  vpsPgOnly: false,
  vpsPairing: false,
  localAuthWorker: false,
  vpsAuthPgOnly: false,
  vpsAuthWorker: false,
  vpsRevocationWorker: false,
  productionPairing: true,
  productionAuthWorker: true,
  productionRevocationWorker: true,
};

function controller(readiness?: () => Promise<void>) {
  const sessions = { assertCanManageHome: jest.fn().mockResolvedValue(undefined) };
  const provider = readiness ? { verifyBrokerPrerequisites: jest.fn(readiness) } : undefined;
  return {
    value: new ShellyController({} as never, {} as never, {} as never,
      sessions as never, provider as never),
    sessions,
    provider,
  };
}

describe('Shelly setup capabilities MQTT gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not announce pairing while the MQTT profile is disabled', async () => {
    selectPlan.mockReturnValue({
      ...enabledPlan,
      mode: 'off',
      productionPairing: false,
      productionAuthWorker: false,
      productionRevocationWorker: false,
    });
    const { value, sessions } = controller();
    const result = await value.setupCapabilities(
      { userId: 'owner' } as never, 'home',
    );
    expect(result.pairingAvailability).toBe('BLOCKED');
    expect(result.preferredMethod).toBeNull();
    expect(result.brokerCredentialProvisioning.reason).toBe('MQTT_PAIRING_PROFILE_DISABLED');
    expect(sessions.assertCanManageHome).toHaveBeenCalledWith('owner', 'home');
  });

  it('keeps pairing blocked when the broker does not prove its prerequisites', async () => {
    selectPlan.mockReturnValue(enabledPlan);
    const { value, provider } = controller(() => Promise.reject(new Error('private broker error')));
    const result = await value.setupCapabilities(
      { userId: 'owner' } as never, 'home',
    );
    expect(provider?.verifyBrokerPrerequisites).toHaveBeenCalledTimes(1);
    expect(result.pairingAvailability).toBe('BLOCKED');
    expect(result.brokerCredentialProvisioning.authenticatedConnectionObservation)
      .toBe('NOT_VERIFIED');
    expect(result.brokerCredentialProvisioning.reason)
      .toBe('MOSQUITTO_BROKER_PREREQUISITES_NOT_VERIFIED');
  });

  it('reports readiness only after the broker confirms default-deny and connection observation', async () => {
    selectPlan.mockReturnValue(enabledPlan);
    const { value } = controller(() => Promise.resolve());
    const result = await value.setupCapabilities(
      { userId: 'owner' } as never, 'home',
    );
    expect(result.pairingAvailability).toBe('READY');
    expect(result.preferredMethod).toBe('LAN');
    expect(result.brokerCredentialProvisioning.authenticatedConnectionObservation)
      .toBe('VERIFIED_BY_DYNSEC_GET_CLIENT');
    expect(result.brokerCredentialProvisioning.defaultDeny).toBe(true);
    expect(result.pairingCompletion)
      .toBe('REQUIRES_DEVICE_SPECIFIC_AUTHENTICATED_CONNECTION_AND_RPC_CHALLENGE');
  });
});
