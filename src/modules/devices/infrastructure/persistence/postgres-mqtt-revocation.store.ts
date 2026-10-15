import type { Pool } from 'pg';
import {
  MqttRevocationClaim,
  MqttRevocationFailure,
  MqttRevocationStore,
  MqttRevocationStoreError,
} from '../../application/services/mqtt-revocation.worker';

/** Supply a dedicated pool whose login inherits ONLY smarthome_mqtt_revoke.
 * Each query is autocommitted; never hold a SQL transaction over broker I/O.
 * Lifecycle/configuration of the pool belongs to the future deployment wiring.
 */
export class PostgresMqttRevocationStore implements MqttRevocationStore {
  constructor(private readonly pool: Pool) {}

  async claim(): Promise<MqttRevocationClaim | null> {
    try {
      const result = await this.pool.query<{
        identity_id: string;
        claim_token: string;
        attempt: number;
      }>('SELECT * FROM devices.fn_claim_mqtt_revocation()');
      const row = result.rows[0];
      return row
        ? {
            identityId: row.identity_id,
            claimToken: row.claim_token,
            attempt: row.attempt,
          }
        : null;
    } catch {
      throw new MqttRevocationStoreError();
    }
  }

  async finish(
    claim: MqttRevocationClaim,
    error: MqttRevocationFailure | null,
  ): Promise<boolean> {
    try {
      const result = await this.pool.query<{ applied: boolean }>(
        'SELECT devices.fn_finish_mqtt_revocation($1::uuid, $2::uuid, $3::text) AS applied',
        [claim.identityId, claim.claimToken, error],
      );
      return result.rows[0]?.applied === true;
    } catch {
      throw new MqttRevocationStoreError();
    }
  }
}
