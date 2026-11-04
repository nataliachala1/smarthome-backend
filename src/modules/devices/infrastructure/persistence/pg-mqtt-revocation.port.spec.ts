import { PgMqttRevocationPort } from './pg-mqtt-revocation.port';

const OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDENTITY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USERNAME = `shd_${IDENTITY.replace(/-/g, '')}`;
const CLIENT = `shd-${IDENTITY.replace(/-/g, '')}`;
const ROLE = `role_shd_${IDENTITY.replace(/-/g, '')}`;

describe('PgMqttRevocationPort', () => {
  it('claims an unbound operation with the exact reserved broker binding', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{
      operationId: OP, leaseToken: TOKEN,
      leaseUntil: new Date(Date.now() + 30_000), identityId: IDENTITY,
      username: USERNAME, clientId: CLIENT, roleName: ROLE,
      attempt: 1, revocationProbeAt: null,
    }] }) };
    const port = new PgMqttRevocationPort(db);
    await expect(port.claim()).resolves.toMatchObject({
      operationId: OP, identityId: IDENTITY, source: 'pairing-operation',
      claimToken: TOKEN, username: USERNAME, clientId: CLIENT, roleName: ROLE,
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('fn_claim_mqtt_pairing_revocation'), [60],
    );
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    { operationId: OP, leaseToken: TOKEN, leaseUntil: new Date(Date.now() - 10_000),
      identityId: IDENTITY, username: USERNAME, clientId: CLIENT, roleName: ROLE, attempt: 1, revocationProbeAt: null },
    { operationId: 'bad', leaseToken: TOKEN, leaseUntil: new Date(Date.now() + 30_000),
      identityId: IDENTITY, username: USERNAME, clientId: CLIENT, roleName: ROLE, attempt: 1, revocationProbeAt: null },
    { operationId: OP, leaseToken: TOKEN, leaseUntil: new Date(Date.now() + 30_000),
      identityId: IDENTITY, username: 'bad name', clientId: CLIENT, roleName: ROLE, attempt: 1, revocationProbeAt: null },
  ])('rejects invalid pairing claim data', async (row) => {
    const port = new PgMqttRevocationPort({ query: jest.fn().mockResolvedValue({ rows: [row] }) });
    await expect(port.claim()).rejects.toThrow('MQTT_REVOCATION_CLAIM_INVALID');
  });

  it('falls through to the existing SQL011 identity queue and accepts legacy binding', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        identityId: IDENTITY, leaseToken: TOKEN, attempt: 3,
        operationId: null, revocationProbeAt: null,
        username: `device-${IDENTITY}`, clientId: null, roleName: null,
      }] }) };
    const port = new PgMqttRevocationPort(db);
    await expect(port.claim()).resolves.toMatchObject({
      identityId: IDENTITY, attempt: 3, username: `device-${IDENTITY}`,
      clientId: null, roleName: null, source: 'registered-identity',
    });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('rejects partial broker binding and malformed evidence completion', async () => {
    const db = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        identityId: IDENTITY, leaseToken: TOKEN, attempt: 1,
        operationId: null, revocationProbeAt: null,
        username: `device-${IDENTITY}`, clientId: 'legacy-client', roleName: null,
      }] }) };
    const port = new PgMqttRevocationPort(db);
    await expect(port.claim()).rejects.toThrow('MQTT_REVOCATION_CLAIM_INVALID');
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(port.finish({ identityId: IDENTITY, claimToken: TOKEN, attempt: 1,
      source: 'pairing-operation', operationId: OP }, null, 'IDENTITY_ABSENT'))
      .rejects.toThrow('MQTT_REVOCATION_FINISH_INVALID');
  });

  it('requires broker evidence for successful completion and preserves a false fence result', async () => {
    const db = { query: jest.fn().mockResolvedValue({ rows: [{ finished: false }] }) };
    const port = new PgMqttRevocationPort(db);
    const claim = { identityId: IDENTITY, claimToken: TOKEN, attempt: 1,
      source: 'registered-identity' as const };
    await expect(port.finish(claim, null)).rejects.toThrow('MQTT_REVOCATION_EVIDENCE_REQUIRED');
    await expect(port.finish(claim, null, 'IDENTITY_ABSENT')).resolves.toBe(false);
  });

  it('does not route a claim with an unknown source to either SQL function', async () => {
    const db = { query: jest.fn() };
    const port = new PgMqttRevocationPort(db);
    await expect(port.finish({ identityId: IDENTITY, claimToken: TOKEN,
      attempt: 1 }, null, 'IDENTITY_ABSENT'))
      .rejects.toThrow('MQTT_REVOCATION_CLAIM_INVALID');
    expect(db.query).not.toHaveBeenCalled();
  });
});
