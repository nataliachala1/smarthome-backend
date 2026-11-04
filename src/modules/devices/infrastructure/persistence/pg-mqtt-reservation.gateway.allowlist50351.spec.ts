import {
  PgMqttReservationGateway,
  isAllowedMqttReservationQuery,
} from './pg-mqtt-reservation.gateway';

// Identical query template to PgMqttPrivilegedReservationPort.reserve(...).
const sql = `SELECT operation_id::text AS "operationId",
                identity_id::text AS "identityId",
                username::text AS "username",
                client_id::text AS "clientId",
                role_name::text AS "roleName",
                reserved_topic_scope::text AS "reservedTopicScope"
           FROM devices.fn_reserve_mqtt_pairing_operation(
             $1::uuid, $2::text, $3::uuid, $4::text
           )`;
const params: unknown[] = [
  '11111111-1111-4111-8111-111111111111',
  'devices/lab039/fixture',
  '22222222-2222-4222-8222-222222222222',
  'a'.repeat(64),
];

const privileges = {
  role: 'smarthome_mqtt_reserver_lab039_login', database: 'smarthome_039_lab',
  reserver_usage: true, schema_usage: true, can_reserve: true,
  can_login: true, inherits: true, direct_memberships: 1,
  lease_member: false, confirmer_member: false, registrar_member: false,
  revoke_member: false, can_claim: false, can_report: false,
  can_quarantine: false, can_confirm: false, can_register: false,
  operation_select: false, operation_insert: false, operation_update: false,
  operation_delete: false, identity_select: false, session_select: false,
  superuser: false, bypass_rls: false, create_role: false, create_db: false,
  replication: false,
};

describe('SQL022 reservation strict allowlist 503.51', () => {
  it('accepts only the actual full adapter query and validated params', () => {
    expect(isAllowedMqttReservationQuery(sql, params)).toBe(true);
    expect(isAllowedMqttReservationQuery(`  ${sql.replace(/\n/g, '  ')}  `, params)).toBe(true);
  });

  it.each([
    'SELECT 1',
    `SELECT operation_id::text AS "operationId" FROM devices.fn_reserve_mqtt_pairing_operation($1::uuid,$2::text,$3::uuid,$4::text)`,
    sql + ' UNION SELECT 1',
    sql + ' LIMIT 1',
    sql + '; SELECT 1',
    sql + ' -- trailing comment',
    sql.replace('fn_reserve_mqtt_pairing_operation', 'fn_claim_mqtt_pairing_preparation'),
    sql.replace('$2::text, $3::uuid', '$3::text, $2::uuid'),
    sql.replace('reserved_topic_scope::text', 'other_column::text'),
    sql.replace('devices.fn_reserve', 'public.fn_reserve'),
    sql.replace('AS "identityId"', 'AS "identityID"'),
  ])('rejects SQL variants and appendages: %s', (candidate) => {
    expect(isAllowedMqttReservationQuery(candidate, params)).toBe(false);
  });

  it.each([
    [], params.slice(0, 3), [...params, 'extra'],
    [null, ...params.slice(1)],
    ['11111111-1111-1111-1111-111111111111', ...params.slice(1)],
    [params[0], '', params[2], params[3]],
    [params[0], 'a'.repeat(257), params[2], params[3]],
    [params[0], 'devices/#', params[2], params[3]],
    [params[0], params[1], 'not-a-uuid', params[3]],
    [params[0], params[1], params[2], 'not-sha256'],
    [params[0], params[1], params[2], 'A'.repeat(64)],
  ].map((candidate) => [candidate]))('rejects invalid bindings: %j', (candidate) => {
    expect(isAllowedMqttReservationQuery(sql, candidate)).toBe(false);
  });

  it('blocks unauthorized SQL before reaching the PostgreSQL pool', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [privileges] }),
      end: jest.fn().mockResolvedValue(undefined),
    };
    const gateway = new PgMqttReservationGateway(pool);
    await expect(gateway.query(sql, params)).rejects.toThrow('MQTT_RESERVER_NOT_READY');
    expect(pool.query).not.toHaveBeenCalled();
    await gateway.verifyPrivileges();
    expect(pool.query).toHaveBeenCalledTimes(1);
    for (const candidate of ['SELECT 1', sql + ' UNION SELECT 1', sql + '; SELECT 1']) {
      await expect(gateway.query(candidate, params)).rejects.toThrow('MQTT_RESERVER_SQL_NOT_ALLOWED');
    }
    await expect(gateway.query(sql, [...params, 'extra'])).rejects.toThrow('MQTT_RESERVER_SQL_NOT_ALLOWED');
    expect(pool.query).toHaveBeenCalledTimes(1);
    await expect(gateway.query(sql, params)).resolves.toEqual({ rows: [privileges] });
    expect(pool.query).toHaveBeenCalledTimes(2);
    await gateway.close();
    expect(pool.end).toHaveBeenCalledTimes(1);
    await expect(gateway.query(sql, params)).rejects.toThrow('MQTT_RESERVER_NOT_READY');
  });
});
