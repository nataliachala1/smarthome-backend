import { BrokerAdminError } from '../../infrastructure/messaging/identity/mosquitto-admin.transport';

export interface MqttRevocationClaim {
  identityId: string;
  claimToken: string;
  attempt: number;
  source?: 'pairing-operation' | 'registered-identity';
  operationId?: string;
  username?: string;
  clientId?: string | null;
  roleName?: string | null;
  revocationProbeAt?: Date | null;
}

export type MqttRevocationEvidence =
  | 'IDENTITY_ABSENT'
  | 'DISABLED_NO_CONNECTIONS';

export type MqttRevocationFailure =
  BrokerAdminError['code'] | 'MQTT_REVOCATION_UNEXPECTED';
export type MqttRevocationFinishResult =
  | boolean
  | 'REVOKED'
  | 'RETRY_SCHEDULED'
  | 'LEASE_LOST';

export interface MqttRevocationStore {
  claim(): Promise<MqttRevocationClaim | null>;
  finish(
    claim: MqttRevocationClaim,
    error: MqttRevocationFailure | null,
    evidence?: MqttRevocationEvidence,
  ): Promise<MqttRevocationFinishResult>;
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
    private readonly broker: {
      revoke?(identityId: string): Promise<void | MqttRevocationEvidence>;
      revokeClaim?(claim: MqttRevocationClaim): Promise<MqttRevocationEvidence>;
    },
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
    let evidence: MqttRevocationEvidence | undefined;
    try {
      if (this.broker.revokeClaim) {
        evidence = await this.broker.revokeClaim(claim);
      } else if (this.broker.revoke) {
        evidence = await this.broker.revoke(claim.identityId) ?? undefined;
      } else {
        throw new Error('MQTT_REVOCATION_BROKER_UNAVAILABLE');
      }
    } catch (error) {
      failure =
        error instanceof BrokerAdminError
          ? error.code
          : 'MQTT_REVOCATION_UNEXPECTED';
    }
    try {
      // A failed DB write leaves the lease recoverable even if the broker ACKed.
      // Do not catch that write as a broker failure or attempt a second DB write.
      const applied = evidence === undefined
        ? await this.store.finish(claim, failure)
        : await this.store.finish(claim, failure, evidence);
      if (applied === false || applied === 'LEASE_LOST') return 'LEASE_LOST';
      if (failure !== null) return 'RETRY_SCHEDULED';
      if (applied === 'RETRY_SCHEDULED') return 'RETRY_SCHEDULED';
      if (applied === 'REVOKED') return 'REVOKED';
      // Old SQL011 stores return a boolean. A pairing claim must never infer
      // completion from the Node clock; only the SQL032 result can do that.
      if (claim.operationId) return 'RETRY_SCHEDULED';
    } catch {
      throw new MqttRevocationStoreError();
    }
    return 'REVOKED';
  }
}
