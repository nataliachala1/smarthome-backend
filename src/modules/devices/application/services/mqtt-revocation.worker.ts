import { BrokerAdminError } from '../../infrastructure/messaging/identity/mosquitto-admin.transport';

export interface MqttRevocationClaim {
  identityId: string;
  claimToken: string;
  attempt: number;
}

export type MqttRevocationFailure =
  BrokerAdminError['code'] | 'MQTT_REVOCATION_UNEXPECTED';

export interface MqttRevocationStore {
  claim(): Promise<MqttRevocationClaim | null>;
  finish(
    claim: MqttRevocationClaim,
    error: MqttRevocationFailure | null,
  ): Promise<boolean>;
}

export class MqttRevocationStoreError extends Error {
  constructor() {
    super('MQTT_REVOCATION_STORE_UNAVAILABLE');
    this.name = 'MqttRevocationStoreError';
  }
}

/** Explicitly invoked internal worker. No scheduler, connection, or Nest provider
 * is registered here. The broker client must use HU11's bounded admin transport.
 * Only disableClient is retryable: this worker never rotates/enables a client.
 */
export class MqttRevocationWorker {
  constructor(
    private readonly store: MqttRevocationStore,
    private readonly broker: { revoke(identityId: string): Promise<void> },
  ) {}

  async runOnce(): Promise<
    'IDLE' | 'REVOKED' | 'RETRY_SCHEDULED' | 'LEASE_LOST'
  > {
    let claim: MqttRevocationClaim | null;
    try {
      claim = await this.store.claim();
    } catch {
      throw new MqttRevocationStoreError();
    }
    if (!claim) return 'IDLE';

    let failure: MqttRevocationFailure | null = null;
    try {
      await this.broker.revoke(claim.identityId);
    } catch (error) {
      failure =
        error instanceof BrokerAdminError
          ? error.code
          : 'MQTT_REVOCATION_UNEXPECTED';
    }
    try {
      // A failed DB write leaves the lease recoverable even if the broker ACKed.
      // Do not catch that write as a broker failure or attempt a second DB write.
      if (!(await this.store.finish(claim, failure))) return 'LEASE_LOST';
    } catch {
      throw new MqttRevocationStoreError();
    }
    return failure === null ? 'REVOKED' : 'RETRY_SCHEDULED';
  }
}
