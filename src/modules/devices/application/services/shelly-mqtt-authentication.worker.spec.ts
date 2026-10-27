import { ShellyMqttAuthenticationWorker } from './shelly-mqtt-authentication.worker';
import type { ShellyRpcChallenge } from './shelly-mqtt-rpc-challenge.policy';
import { MqttTopicContract } from '../../infrastructure/messaging/mqtt-topic-contract';

const op = 'd73bb6ab-d11c-4ead-80e1-ccf714b48923';
const rpcId = '35bb8cd2-cd14-4d5a-ad75-2d496e90945a';
const id = 'shelly1pmg4-aabbccddeeff';
const scope = `smarthome/devices/${id}`;
const binding = { username: 'shd_aabbcc', clientId: 'shd-aabbcc', roleName: 'role_shd_aabbcc' };
const snapshot = {
  ...binding, disabled: false, roleNames: [binding.roleName], authenticatedConnectionCount: 1,
};
const topics = new MqttTopicContract({
  namespace: 'smarthome', devicePrefix: 'smarthome/devices',
  switchId: 0, tls: true, rpcSource: 'smarthome/backend',
});
const issue = () => {
 const now = Date.now();
 return ({
  rpcId, manufacturerDeviceId: id,
  requestTopic: `${scope}/rpc`, responseTopic: `${scope}/events/rpc`,
  requestSource: `${scope}/events`, issuedAt: new Date(now),
  expiresAt: new Date(now + 15000),
  brokerUsername: binding.username,
  brokerClientId: binding.clientId, brokerRoleName: binding.roleName,
 });
};
const reply = (c: { rpcId: string; responseTopic: string; source: string }) => ({
  topic: c.responseTopic, retain: false, receivedAtMs: Date.now(),
  payload: JSON.stringify({
    id: c.rpcId, src: id, dst: c.source,
    result: { id, model: 'S4SW-001P16EU', gen: 4 },
  }),
});

function harness(options: {
  reportedId?: string; disabled?: boolean; retained?: boolean;
  wrongScope?: boolean; disconnectedAfter?: boolean;
} = {}) {
  const issueSpy = jest.fn().mockResolvedValue({ ...issue(),
    rpcId: options.reportedId ?? rpcId,
    requestTopic: options.wrongScope ? 'otro/rpc' : `${scope}/rpc`,
  });
  const consume = jest.fn().mockResolvedValue(undefined);
  const confirm = jest.fn().mockResolvedValue(undefined);
  const inspectIdentity = jest.fn()
    .mockResolvedValueOnce({ ...snapshot, disabled: options.disabled ?? false })
    .mockResolvedValueOnce({ ...snapshot,
      authenticatedConnectionCount: options.disconnectedAfter ? 0 : 1 });
  const observedChallenges: ShellyRpcChallenge[] = [];
  const exchange = jest.fn<(c: ShellyRpcChallenge) => Promise<ReturnType<typeof reply>>>()
    .mockImplementation((c: ShellyRpcChallenge) => {
      observedChallenges.push(c);
      return Promise.resolve({
        ...reply(c), retain: options.retained ?? false,
      });
    });
  const worker = new ShellyMqttAuthenticationWorker(
    { issue: issueSpy, consume }, { confirm }, { inspectIdentity }, { exchange }, topics, 0,
  );
  return { worker, issueSpy, consume, confirm, inspectIdentity, exchange, observedChallenges };
}

describe('Etapa 1: SQL026 + prueba broker + SQL029 (sin red)', () => {
  it('consume SOLO el rpc_id emitido por SQL026 y confirma SQL029', async () => {
    const t = harness();
    await expect(t.worker.confirm(op)).resolves.toEqual({
      phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED',
    });
    expect(t.consume).toHaveBeenCalledWith(op, rpcId);
    expect(t.confirm).toHaveBeenCalledWith(op, rpcId, binding);
    expect(t.observedChallenges).toHaveLength(1);
    const challenge = t.observedChallenges[0];
    expect(challenge.rpcId).toBe(rpcId);
    const rpcRequest: unknown = JSON.parse(challenge.payload);
    expect(rpcRequest).toMatchObject({ id: rpcId });
    expect(t.inspectIdentity).toHaveBeenCalledTimes(2);
  });
  it('nunca publica ni persiste si la identidad esta deshabilitada', async () => {
    const t = harness({ disabled: true });
    await expect(t.worker.confirm(op)).rejects.toThrow('BROKER_NOT_AUTHENTICATED');
    expect(t.exchange).not.toHaveBeenCalled();
    expect(t.consume).not.toHaveBeenCalled();
    expect(t.confirm).not.toHaveBeenCalled();
  });
  it('no consume ni confirma una respuesta MQTT retenida', async () => {
    const t = harness({ retained: true });
    await expect(t.worker.confirm(op)).rejects.toThrow('RPC_NOT_VERIFIED');
    expect(t.consume).not.toHaveBeenCalled();
    expect(t.confirm).not.toHaveBeenCalled();
  });
  it('rechaza scope de SQL que no coincide con el fabricante', async () => {
    const t = harness({ wrongScope: true });
    await expect(t.worker.confirm(op)).rejects.toThrow('SCOPE_OR_WINDOW_INVALID');
    expect(t.inspectIdentity).not.toHaveBeenCalled();
    expect(t.confirm).not.toHaveBeenCalled();
  });
  it('requiere conexion autenticada despues del RPC', async () => {
    const t = harness({ disconnectedAfter: true });
    await expect(t.worker.confirm(op)).rejects.toThrow('BROKER_UNCERTAIN');
    expect(t.consume).not.toHaveBeenCalled();
    expect(t.confirm).not.toHaveBeenCalled();
  });
});
