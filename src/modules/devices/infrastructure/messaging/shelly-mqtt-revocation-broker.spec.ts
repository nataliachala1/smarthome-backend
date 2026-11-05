import type { MqttDeviceIdentityProvider, MqttBrokerIdentitySnapshot } from '../../domain/services/mqtt-device-identity-provider';
import type { MqttRevocationClaim } from '../../application/services/mqtt-revocation.worker';
import { ShellyMqttRevocationBroker } from './shelly-mqtt-revocation-broker';

const ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const claim: MqttRevocationClaim = {
  identityId: ID,
  claimToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  attempt: 1,
  source: 'pairing-operation',
  operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  username: `shd_${ID.replace(/-/g, '')}`,
  clientId: `shd-${ID.replace(/-/g, '')}`,
  roleName: `role_shd_${ID.replace(/-/g, '')}`,
};

const snapshot = (
  overrides: Partial<MqttBrokerIdentitySnapshot> = {},
): MqttBrokerIdentitySnapshot => ({
  username: claim.username!,
  clientId: claim.clientId!,
  disabled: false,
  roleNames: [claim.roleName!],
  authenticatedConnectionCount: 0,
  ...overrides,
});

describe('ShellyMqttRevocationBroker', () => {
  let provider: jest.Mocked<Pick<MqttDeviceIdentityProvider,
    'inspectIdentity' | 'disableIdentity'>>;
  let broker: ShellyMqttRevocationBroker;

  beforeEach(() => {
    provider = {
      inspectIdentity: jest.fn(),
      disableIdentity: jest.fn().mockResolvedValue(undefined),
    };
    broker = new ShellyMqttRevocationBroker(provider as unknown as MqttDeviceIdentityProvider);
  });

  it('solo deshabilita la identidad asociada al claim y comprueba estado y conexiones', async () => {
    provider.inspectIdentity
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ disabled: true }));
    await expect(broker.revokeClaim(claim)).resolves.toBe('DISABLED_NO_CONNECTIONS');
    expect(provider.disableIdentity).toHaveBeenCalledWith(claim.username);
    expect(provider.inspectIdentity).toHaveBeenCalledTimes(2);
  });

  it('confirma ausencia solo a partir de una respuesta explícita del broker', async () => {
    provider.inspectIdentity.mockResolvedValueOnce(null);
    await expect(broker.revokeClaim(claim)).resolves.toBe('IDENTITY_ABSENT');
    expect(provider.disableIdentity).not.toHaveBeenCalled();
  });

  it.each([
    snapshot({ clientId: 'another-client' }),
    snapshot({ roleNames: ['another-role'] }),
  ])('no deshabilita una identidad cuyo binding no coincide', async (wrong) => {
    provider.inspectIdentity.mockResolvedValueOnce(wrong);
    await expect(broker.revokeClaim(claim)).rejects.toThrow('MQTT_REVOCATION_BINDING_MISMATCH');
    expect(provider.disableIdentity).not.toHaveBeenCalled();
  });

  it.each([
    snapshot({ disabled: false }),
    snapshot({ disabled: true, authenticatedConnectionCount: 1 }),
    snapshot({ disabled: true, authenticatedConnectionCount: null }),
  ])('no genera evidencia cuando el broker no demuestra revocación completa', async (after) => {
    provider.inspectIdentity.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(after);
    await expect(broker.revokeClaim(claim)).rejects.toThrow('MQTT_REVOCATION_OUTCOME_UNVERIFIED');
  });

  it('no interpreta fallos/timeout de consulta como ausencia y no inicia otra operación', async () => {
    provider.inspectIdentity.mockRejectedValueOnce(new Error('transport timeout'));
    await expect(broker.revokeClaim(claim)).rejects.toThrow('transport timeout');
    expect(provider.disableIdentity).not.toHaveBeenCalled();
  });

  it('valida binding legado por username, clientId existente y un solo rol', async () => {
    const legacyClaim = { ...claim, source: 'registered-identity' as const,
      operationId: undefined, username: `device-${ID}`, clientId: null, roleName: null };
    provider.inspectIdentity
      .mockResolvedValueOnce(snapshot({ username: legacyClaim.username, clientId: 'legacy-client', roleNames: ['legacy-role'] }))
      .mockResolvedValueOnce(snapshot({ username: legacyClaim.username, clientId: 'legacy-client', roleNames: ['legacy-role'], disabled: true }));
    await expect(broker.revokeClaim(legacyClaim)).resolves.toBe('DISABLED_NO_CONNECTIONS');
    expect(provider.disableIdentity).toHaveBeenCalledWith(legacyClaim.username);
  });
});
