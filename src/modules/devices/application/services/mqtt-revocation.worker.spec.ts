import { BrokerAdminError } from '../../infrastructure/messaging/identity/mosquitto-admin.transport';
import {
  MqttRevocationClaim,
  MqttRevocationFailure,
  MqttRevocationWorker,
} from './mqtt-revocation.worker';

describe('durable MQTT revocation worker', () => {
  const claim: MqttRevocationClaim = {
    identityId: '22aaccdd-1111-4111-8111-123456789abc',
    claimToken: '22aaccdd-2222-4222-8222-123456789abc',
    attempt: 1,
  };
  let store: {
    claim: jest.Mock<Promise<MqttRevocationClaim | null>, []>;
    finish: jest.Mock<
      Promise<boolean>,
      [MqttRevocationClaim, MqttRevocationFailure | null]
    >;
  };
  let broker: { revoke: jest.Mock<Promise<void>, [string]> };
  let worker: MqttRevocationWorker;

  beforeEach(() => {
    store = {
      claim: jest
        .fn<Promise<MqttRevocationClaim | null>, []>()
        .mockResolvedValue(claim),
      finish: jest
        .fn<
          Promise<boolean>,
          [MqttRevocationClaim, MqttRevocationFailure | null]
        >()
        .mockResolvedValue(true),
    };
    broker = {
      revoke: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    };
    worker = new MqttRevocationWorker(store, broker);
  });

  it('does not contact the broker with no pending task', async () => {
    store.claim.mockResolvedValue(null);
    await expect(worker.runOnce()).resolves.toBe('IDLE');
    expect(broker.revoke).not.toHaveBeenCalled();
    expect(store.finish).not.toHaveBeenCalled();
  });

  it('commits success only after the administrative response', async () => {
    let acknowledge!: () => void;
    broker.revoke.mockImplementation(
      () => new Promise((resolve) => (acknowledge = resolve)),
    );
    const pending = worker.runOnce();
    await Promise.resolve();
    expect(store.finish).not.toHaveBeenCalled();
    acknowledge();
    await expect(pending).resolves.toBe('REVOKED');
    expect(broker.revoke).toHaveBeenCalledWith(claim.identityId);
    expect(store.finish).toHaveBeenCalledWith(claim, null);
  });

  it.each([
    'MQTT_ADMIN_UNAVAILABLE',
    'MQTT_ADMIN_REJECTED',
    'MQTT_ADMIN_OUTCOME_UNKNOWN',
    'MQTT_ADMIN_INVALID_RESPONSE',
    'MQTT_ADMIN_UNSAFE_DEFAULT_ACL',
  ] as const)('persists only the stable failure code %s', async (code) => {
    broker.revoke.mockRejectedValue(new BrokerAdminError(code));
    await expect(worker.runOnce()).resolves.toBe('RETRY_SCHEDULED');
    expect(store.finish).toHaveBeenCalledWith(claim, code);
  });

  it('never stores unexpected broker error text or credentials', async () => {
    broker.revoke.mockRejectedValue(new Error('password=DO_NOT_STORE'));
    await expect(worker.runOnce()).resolves.toBe('RETRY_SCHEDULED');
    expect(store.finish).toHaveBeenCalledWith(
      claim,
      'MQTT_REVOCATION_UNEXPECTED',
    );
  });

  it('does not contact the broker when the database claim fails', async () => {
    store.claim.mockRejectedValue(new Error('postgres://user:secret@db'));
    await expect(worker.runOnce()).rejects.toThrow(
      'MQTT_REVOCATION_STORE_UNAVAILABLE',
    );
    expect(broker.revoke).not.toHaveBeenCalled();
  });

  it('preserves recovery by lease after ACK then database failure', async () => {
    store.finish.mockRejectedValue(new Error('private SQL details'));
    await expect(worker.runOnce()).rejects.toThrow(
      'MQTT_REVOCATION_STORE_UNAVAILABLE',
    );
    expect(store.finish).toHaveBeenCalledTimes(1);
    expect(store.finish).toHaveBeenCalledWith(claim, null);
    expect(broker.revoke).toHaveBeenCalledTimes(1);
  });

  it.each([null, new BrokerAdminError('MQTT_ADMIN_OUTCOME_UNKNOWN')])(
    'never reports success/retry if its claim was superseded',
    async (error) => {
      if (error) broker.revoke.mockRejectedValue(error);
      store.finish.mockResolvedValue(false);
      await expect(worker.runOnce()).resolves.toBe('LEASE_LOST');
    },
  );
});
