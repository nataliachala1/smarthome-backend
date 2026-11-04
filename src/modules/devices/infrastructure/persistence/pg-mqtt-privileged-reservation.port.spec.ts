import { PgMqttPrivilegedReservationPort } from './pg-mqtt-privileged-reservation.port';

const sessionId = 'cb3c2441-6290-46d3-88d7-13e141c1f421';
const actorId = '7ac88c31-cd8e-4c4e-bb2b-82fbbe390384';
const identityId = '1e3c51b2-4f8a-4c3e-9a24-0acc5bf55e21';
const operationId = 'd4ecb743-a612-482e-b89b-3c4d3f0c7145';
const scope = 'smarthome/test/devices/shelly1pmg4-123';
const proof = 'a'.repeat(64);
const suffix = identityId.replace(/-/g, '');
const valid = {
  operationId,
  identityId,
  username: `shd_${suffix}`,
  clientId: `shd-${suffix}`,
  roleName: `role_shd_${suffix}`,
  reservedTopicScope: scope,
};
function harness(rows: unknown[] = [valid]) {
  const query = jest.fn().mockResolvedValue({ rows });
  return { query, port: new PgMqttPrivilegedReservationPort({ query }) };
}

describe('PgMqttPrivilegedReservationPort - SQL 022 (no DI)', () => {
  it('uses only privileged SQL 022 with parameterized arguments', async () => {
    const { port, query } = harness();
    await expect(port.reserve(sessionId, scope, actorId, proof)).resolves.toEqual(valid);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('fn_reserve_mqtt_pairing_operation'),
      [sessionId, scope, actorId, proof],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('$4::text'),
      [sessionId, scope, actorId, proof],
    );
  });

  it.each([
    ['invalid session', 'bad', scope, actorId, proof],
    ['invalid owner', sessionId, scope, 'bad', proof],
    ['invalid hash', sessionId, scope, actorId, 'not-a-hash'],
    ['uppercase hash', sessionId, scope, actorId, 'A'.repeat(64)],
    ['wildcard', sessionId, 'smarthome/#', actorId, proof],
    ['empty scope', sessionId, '', actorId, proof],
    ['oversize scope', sessionId, 'x'.repeat(257), actorId, proof],
  ])('rejects %s before SQL', async (_label, session, topic, actor, hash) => {
    const { port, query } = harness();
    await expect(port.reserve(session, topic, actor, hash))
      .rejects.toThrow('MQTT_RESERVATION_INPUT_INVALID');
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['no rows', []],
    ['duplicate rows', [valid, valid]],
    ['invalid operation UUID', [{ ...valid, operationId: 'not-uuid' }]],
    ['invalid identity UUID', [{ ...valid, identityId: 'not-uuid' }]],
    ['wrong scope', [{ ...valid, reservedTopicScope: 'other/devices/shelly1pmg4-123' }]],
    ['wrong type', [{ ...valid, clientId: 12 }]],
  ])('fails closed on %s', async (_label, rows) => {
    const { port } = harness(rows);
    await expect(port.reserve(sessionId, scope, actorId, proof))
      .rejects.toThrow('MQTT_RESERVATION_RESPONSE_INVALID');
  });

  it.each(['username', 'clientId', 'roleName'] as const)(
    'rejects forged %s binding', async (field) => {
      const { port } = harness([{ ...valid, [field]: 'forged' }]);
      await expect(port.reserve(sessionId, scope, actorId, proof))
        .rejects.toThrow('MQTT_RESERVATION_BINDING_INVALID');
    },
  );

  it('treats communication failure as uncertain rather than retrying', async () => {
    const { port, query } = harness();
    query.mockRejectedValueOnce(new Error('sensitive DB message'));
    await expect(port.reserve(sessionId, scope, actorId, proof))
      .rejects.toThrow('MQTT_RESERVATION_OUTCOME_UNKNOWN');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
