import { ShellyMqttBrokerProofCoordinator } from './shelly-mqtt-broker-proof.coordinator';
import type { ShellyMqttAclPlan } from './shelly-mqtt-acl.policy';
import type { ShellyRpcChallenge } from './shelly-mqtt-rpc-challenge.policy';

const id = 'shelly1pmg4-aabbccddeeff';
const scope = `smarthome/devices/${id}`;
const plan: ShellyMqttAclPlan = {
  manufacturerDeviceId: id,
  topicScope: scope,
  acls: [
    { type: 'publishClientSend', topic: `${scope}/status/switch:0`, priority: 10 },
    { type: 'publishClientSend', topic: `${scope}/events/rpc`, priority: 10 },
    { type: 'subscribeLiteral', topic: `${scope}/rpc`, priority: 10 },
    { type: 'publishClientReceive', topic: `${scope}/rpc`, priority: 10 },
    { type: 'unsubscribeLiteral', topic: `${scope}/rpc`, priority: 10 },
  ],
};
const binding = {
  username: 'shd_00112233445566778899aabbccddeeff',
  clientId: 'shd-00112233445566778899aabbccddeeff',
  roleName: 'shdrole_00112233445566778899aabbccddeeff',
};
const snapshot = {
  username: binding.username,
  clientId: binding.clientId,
  roleNames: [binding.roleName],
  disabled: false,
  authenticatedConnectionCount: 1,
};
const validReply = (c: ShellyRpcChallenge) => ({
  topic: c.responseTopic,
  retain: false,
  receivedAtMs: Date.now(),
  payload: JSON.stringify({
    id: c.rpcId, src: id, dst: c.source,
    result: { id, model: 'S4SW-001P16EU', gen: 4 },
  }),
});

describe('50414 desafio RPC del dispositivo MQTT autenticado, sin SQL/red', () => {
  it('solo confirma observacion; nunca marca CONNECTED ni registra equipo', async () => {
    const inspectIdentity = jest.fn().mockResolvedValue(snapshot);
    const exchange = jest.fn().mockImplementation((c: ShellyRpcChallenge) => Promise.resolve(validReply(c)));
    const sut = new ShellyMqttBrokerProofCoordinator({ inspectIdentity }, { exchange });
    await expect(sut.observe({ plan, binding })).resolves.toEqual({
      phase: 'MQTT_CHALLENGE_MATCHED_UNPERSISTED', mqttObserved: true,
    });
    expect(inspectIdentity).toHaveBeenCalledTimes(2);
    expect(exchange).toHaveBeenCalledTimes(1);
  });
  it('rechaza identidad deshabilitada y ni siquiera publica desafio', async () => {
    const exchange = jest.fn();
    const sut = new ShellyMqttBrokerProofCoordinator(
      { inspectIdentity: jest.fn().mockResolvedValue({ ...snapshot, disabled: true }) },
      { exchange },
    );
    await expect(sut.observe({ plan, binding })).rejects.toThrow('BROKER_NOT_AUTHENTICATED');
    expect(exchange).not.toHaveBeenCalled();
  });
  it('rechaza respuesta retenida y tambien una identidad diferente', async () => {
    const inspectIdentity = jest.fn().mockResolvedValue(snapshot);
    const sut = new ShellyMqttBrokerProofCoordinator(
      { inspectIdentity }, { exchange: (c: ShellyRpcChallenge) => Promise.resolve({ ...validReply(c), retain: true }) },
    );
    await expect(sut.observe({ plan, binding })).rejects.toThrow('RPC_UNVERIFIED');
    const wrong = new ShellyMqttBrokerProofCoordinator(
      { inspectIdentity: jest.fn().mockResolvedValue({ ...snapshot, clientId: 'otro' }) },
      { exchange: (c: ShellyRpcChallenge) => Promise.resolve(validReply(c)) },
    );
    await expect(wrong.observe({ plan, binding })).rejects.toThrow('BROKER_NOT_AUTHENTICATED');
  });
  it('requiere conexion autenticada fresca DESPUES del RPC', async () => {
    const inspectIdentity = jest.fn()
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ ...snapshot, authenticatedConnectionCount: 0 });
    const sut = new ShellyMqttBrokerProofCoordinator(
      { inspectIdentity }, { exchange: (c: ShellyRpcChallenge) => Promise.resolve(validReply(c)) },
    );
    await expect(sut.observe({ plan, binding })).rejects.toThrow('BROKER_UNCERTAIN');
  });
  it('propaga indisponibilidad del broker, sin inferir exito', async () => {
    const sut = new ShellyMqttBrokerProofCoordinator(
      { inspectIdentity: jest.fn().mockResolvedValue(snapshot) },
      { exchange: () => Promise.reject(new Error('broker caido')) },
    );
    await expect(sut.observe({ plan, binding })).rejects.toThrow('broker caido');
  });
});
