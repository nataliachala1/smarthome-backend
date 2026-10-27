import {
  isAllowedMqttWorkerQuery,
  MqttWorkerPgGateway,
  type MqttWorkerKind,
} from './mqtt-worker-pg.gateway';

const CLAIM = `SELECT operation_id::text AS "operationId",
                assigned_token::text AS "leaseToken",
                expires_at AS "expiresAt",
                attempt_number AS "attemptNumber"
         FROM devices.fn_claim_mqtt_pairing_preparation($1::uuid, $2::integer)`;
const REPORT = `SELECT devices.fn_report_mqtt_pairing_uncertain(
           $1::uuid, $2::uuid, $3::text
         ) AS reported`;
const CONFIRM = `SELECT devices.fn_confirm_mqtt_pairing_prepared(
           $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
         ) AS confirmed`;

type PrivRow = Record<string, unknown>;
function privileges(kind: MqttWorkerKind): PrivRow {
  return {
    role: `smarthome_mqtt_${kind}_lab039_login`, database: 'smarthome_039_lab',
    lease_member: kind === 'lease', confirmer_member: kind === 'confirmer',
    reserver_member: false, registrar_member: false, revoke_member: false,
    can_claim: kind === 'lease', can_report: kind === 'lease',
    can_quarantine: kind === 'lease', can_confirm: kind === 'confirmer',
    can_reserve: false, can_register: false,
    can_read_operation: false, can_insert_operation: false,
    can_update_operation: false, can_delete_operation: false,
    can_read_identity: false, is_superuser: false, bypass_rls: false,
    can_create_role: false, can_create_db: false,
  };
}
function verifiedGateway(kind: MqttWorkerKind) {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [privileges(kind)] }),
    end: jest.fn().mockResolvedValue(undefined),
  };
  const gw = new MqttWorkerPgGateway(pool, {
    role: `smarthome_mqtt_${kind}_lab039_login`, database: 'smarthome_039_lab',
  }, kind);
  return { gw, pool };
}

describe('503.50 worker gateway SQL allowlist', () => {
  it.each([
    ['lease', CLAIM, ['op', 60]],
    ['lease', REPORT, ['op', 'token', 'MQTT_ADMIN_OUTCOME_UNKNOWN']],
    ['confirmer', CONFIRM, ['op', 'token', 'identity', 'u', 'c', 'r']],
  ] as const)('allows only known %s template', (kind, sql, args) => {
    expect(isAllowedMqttWorkerQuery(sql, args, kind)).toBe(true);
    expect(isAllowedMqttWorkerQuery(`\n ${sql.replace(/\s+/g, ' ')} \n`, args, kind)).toBe(true);
  });

  it('separates lease from confirmer even when SQL is well formed', () => {
    expect(isAllowedMqttWorkerQuery(CONFIRM, ['a', 'b', 'c', 'd', 'e', 'f'], 'lease')).toBe(false);
    expect(isAllowedMqttWorkerQuery(CLAIM, ['a', 30], 'confirmer')).toBe(false);
    expect(isAllowedMqttWorkerQuery(REPORT, ['a', 'b', 'c'], 'confirmer')).toBe(false);
  });

  it.each([
    ['SELECT 1', []],
    ['SELECT * FROM devices.mqtt_pairing_operation', []],
    ['SELECT * FROM devices.mqtt_preparation_secret', []],
    [CLAIM + '; SELECT 1', ['a', 60]],
    [CLAIM + ' -- comment', ['a', 60]],
    [CLAIM + ' /* comment */', ['a', 60]],
    [CLAIM, ['a']],
    [CLAIM, ['a', 60, 7]],
    [REPORT, ['a', 'b']],
    [CONFIRM, ['a', 'b']],
    ['SELECT devices.fn_quarantine_expired_mqtt_pairing_lease($1::uuid)', ['a']],
    ['SELECT devices.fn_register_mqtt_identity($1,$2,$3)', ['a', 'b', 'c']],
    ['SELECT devices.fn_reserve_mqtt_pairing_operation($1,$2,$3,$4)', ['a', 'b', 'c', 'd']],
  ])('rejects unauthorized SQL pattern #%#', (sql, args) => {
    expect(isAllowedMqttWorkerQuery(sql, args, 'lease')).toBe(false);
  });

  it('rejects malformed queries and parameters', () => {
    expect(isAllowedMqttWorkerQuery(null, [], 'lease')).toBe(false);
    expect(isAllowedMqttWorkerQuery(CLAIM, null, 'lease')).toBe(false);
    expect(isAllowedMqttWorkerQuery(CLAIM, { 0: 'a', length: 2 }, 'lease')).toBe(false);
    expect(isAllowedMqttWorkerQuery(CLAIM, ['a', 60], 'bad' as MqttWorkerKind)).toBe(false);
  });

  it.each(['lease', 'confirmer'] as const)('rejects SQL before verification and after closure: %s', async kind => {
    const { gw, pool } = verifiedGateway(kind);
    await expect(gw.query(CLAIM, ['a', 30])).rejects.toThrow('MQTT_WORKER_NOT_READY');
    expect(pool.query).not.toHaveBeenCalled();
    await gw.verifyPrivileges();
    await gw.onModuleDestroy();
    await expect(gw.query(CLAIM, ['a', 30])).rejects.toThrow('MQTT_WORKER_NOT_READY');
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it.each(['lease', 'confirmer'] as const)('never forwards unauthorized calls to pool: %s', async kind => {
    const { gw, pool } = verifiedGateway(kind);
    await gw.verifyPrivileges();
    const callsBefore = pool.query.mock.calls.length;
    await expect(gw.query('SELECT * FROM devices.mqtt_pairing_operation', [])).rejects.toThrow('MQTT_WORKER_SQL_NOT_ALLOWED');
    if (kind === 'lease') {
      await expect(gw.query(CONFIRM, ['a', 'b', 'c', 'd', 'e', 'f'])).rejects.toThrow('MQTT_WORKER_SQL_NOT_ALLOWED');
    } else {
      await expect(gw.query(CLAIM, ['a', 60])).rejects.toThrow('MQTT_WORKER_SQL_NOT_ALLOWED');
    }
    expect(pool.query).toHaveBeenCalledTimes(callsBefore);
    await gw.onModuleDestroy();
  });

  it.each([
    ['lease', CLAIM, ['op', 60]],
    ['lease', REPORT, ['op', 'tok', 'MQTT_ADMIN_OUTCOME_UNKNOWN']],
    ['confirmer', CONFIRM, ['op', 'tok', 'id', 'u', 'c', 'r']],
  ] as const)('forwards exactly one allowed %s SQL statement to pool', async (kind, sql, args) => {
    const { gw, pool } = verifiedGateway(kind);
    await gw.verifyPrivileges();
    await gw.query(sql, [...args]);
    expect(pool.query).toHaveBeenLastCalledWith(sql, [...args]);
    expect(pool.query).toHaveBeenCalledTimes(2);
    await gw.onModuleDestroy();
  });
});
