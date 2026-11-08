export type MqttIdentityAclType =
  | 'publishClientSend'
  | 'publishClientReceive'
  | 'subscribeLiteral'
  | 'subscribePattern'
  | 'unsubscribeLiteral'
  | 'unsubscribePattern';

export interface MqttIdentityAcl {
  readonly type: MqttIdentityAclType;
  readonly topic: string;
  readonly priority: number;
}

export interface PrepareMqttIdentityInput {
  readonly operationId: string;
  readonly username: string;
  readonly clientId: string;
  readonly roleName: string;
  readonly password: string;
  /**
   * Topic prefix of the reserved device.
   * The orchestrator must derive it from MqttTopicContract.shellyPrefix(manufacturerDeviceId)
   * after verifying ownership, session and manufacturerDeviceId.
   * Never trust a prefix supplied by the HTTP/mobile client.
   */
  readonly topicScope: string;
  readonly acls: readonly MqttIdentityAcl[];
}

/** Verifies an already prepared identity without handling or revealing its password. */
export type VerifyPreparedMqttIdentityInput = Pick<
  PrepareMqttIdentityInput,
  'username' | 'clientId' | 'roleName' | 'topicScope' | 'acls'
>;

export interface MqttBrokerIdentitySnapshot {
  readonly username: string;
  readonly clientId: string;
  readonly disabled: boolean;
  readonly roleNames: readonly string[];

  /**
   * null means the provider cannot prove
   * the number of authenticated connections.
   * On its own it is not proof of physical possession.
   */
  readonly authenticatedConnectionCount: number | null;
}

/**
 * Management of individual MQTT credentials.
 *
 * It never uses the backend's control or telemetry
 * MQTT credentials.
 *
 * A communication failure with the broker must throw an error.
 * It must not be interpreted as an absent or revoked identity.
 */
export abstract class MqttDeviceIdentityProvider {
  /** Read-only broker checks required before provisioning can be advertised. */
  abstract verifyBrokerPrerequisites(): Promise<void>;

  /**
   * Prepares the identity without allowing it to connect yet.
   * On return, the clientId, the exact permissions
   * and the disabled state must be confirmed.
   */
  abstract prepareDisabled(
    input: PrepareMqttIdentityInput,
  ): Promise<void>;

  /**
   * null means the broker confirmed the absence.
   * An error or timeout means an unknown state.
   */
  abstract inspectIdentity(
    username: string,
  ): Promise<MqttBrokerIdentitySnapshot | null>;

  /** Re-queries the client, groups, role and five exact ACLs before SQL 027. */
  abstract verifyPreparedDisabled(
    input: VerifyPreparedMqttIdentityInput,
  ): Promise<void>;

  abstract enableIdentity(username: string): Promise<void>;

  /**
   * The implementation must confirm the disabled state and zero
   * authenticated connections; missing or uncertain evidence is not a revocation.
   */
  abstract disableIdentity(username: string): Promise<void>;
}
