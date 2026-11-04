import { createHash } from 'node:crypto';
import { PgMqttEnablePort } from './pg-mqtt-enable.port';

const OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TOKEN = 'A_-'.repeat(15); // 45 URL-safe chars, matching the mobile DTO.
const ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LEASE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SUFFIX = ID.replace(/-/g, '');

describe('PgMqttEnablePort', () => {
  it('pasa a SQL solo el hash del token URL-safe del pairing', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ requested: true }] });
    const port = new PgMqttEnablePort({ query });
    await port.request(OP, USER, TOKEN);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('fn_request_mqtt_enable'),
      [OP, USER, createHash('sha256').update(TOKEN, 'utf8').digest('hex')],
    );
    expect(JSON.stringify(query.mock.calls)).not.toContain(TOKEN);
  });

  it('rechaza un token fuera del contrato antes de llamar SQL', async () => {
    const query = jest.fn();
    const port = new PgMqttEnablePort({ query });
    await expect(port.request(OP, USER, 'short-token')).rejects.toThrow(
      'MQTT_ENABLE_REQUEST_INVALID',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('valida lease, operación e identidad entregadas por fn_claim_mqtt_enable', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{
      operationId: OP,
      leaseToken: LEASE,
      leaseUntil: new Date(Date.now() + 60_000),
      identityId: ID,
      username: `shd_${SUFFIX}`,
      clientId: `shd-${SUFFIX}`,
      roleName: `role_shd_${SUFFIX}`,
    }] });
    const port = new PgMqttEnablePort({ query });
    await expect(port.claim(OP)).resolves.toMatchObject({
      operationId: OP,
      identityId: ID,
      username: `shd_${SUFFIX}`,
      clientId: `shd-${SUFFIX}`,
      roleName: `role_shd_${SUFFIX}`,
    });
  });
});
