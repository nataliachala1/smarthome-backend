import {
  createShellyRpcChallenge,
  matchesShellyRpcChallenge,
  matchesBrokerIdentityConnection,
} from './shelly-mqtt-rpc-challenge.policy';
import type { ShellyMqttAclPlan } from './shelly-mqtt-acl.policy';

const id = 'shelly1pmg4-aabbccddeeff';
function plan(scope = id): ShellyMqttAclPlan {
  return {
    manufacturerDeviceId: id,
    topicScope: scope,
    acls: [
      { type: 'publishClientSend', topic: `${scope}/events/rpc`, priority: 10 },
      { type: 'subscribeLiteral', topic: `${scope}/rpc`, priority: 10 },
    ],
  };
}

function fixture(scope = id) {
  const challenge = createShellyRpcChallenge(plan(scope), 1000);
  const message = {
    topic: challenge.responseTopic,
    retain: false,
    receivedAtMs: 1100,
    payload: JSON.stringify({
      id: challenge.rpcId,
      src: id,
      dst: challenge.source,
      result: { id, model: 'S4SW-001P16EU', gen: 4, mac: 'AABBCCDDEEFF' },
    }),
  };
  return { challenge, message };
}

describe('Shelly MQTT RPC / validación de candidato, SIN broker ni SQL', () => {
  it('envía GetDeviceInfo a rpc y espera la respuesta en <src>/rpc', () => {
    const { challenge, message } = fixture();
    expect(challenge.requestTopic).toBe(`${id}/rpc`);
    expect(challenge.responseTopic).toBe(`${id}/events/rpc`);
    expect(JSON.parse(challenge.payload)).toMatchObject({
      id: challenge.rpcId,
      src: `${id}/events`,
      method: 'Shelly.GetDeviceInfo',
    });
    expect(matchesShellyRpcChallenge(challenge, message)).toBe(true);
  });

  it('respeta el namespace del contrato de topics', () => {
    const scope = `smart-home/devices/${id}`;
    const { challenge, message } = fixture(scope);
    expect(challenge.requestTopic).toBe(`${scope}/rpc`);
    expect(challenge.responseTopic).toBe(`${scope}/events/rpc`);
    expect(matchesShellyRpcChallenge(challenge, message)).toBe(true);
  });

  it('rechaza un scope que no pertenece al Shelly', () => {
    expect(() => createShellyRpcChallenge(plan('otro-dispositivo'))).toThrow();
    expect(() => createShellyRpcChallenge(plan('$CONTROL/dynamic-security/v1'))).toThrow();
  });

  it('rechaza ausencia de ACL RPC necesaria', () => {
    const p = plan();
    expect(() => createShellyRpcChallenge({ ...p, acls: [] })).toThrow();
  });

  it('rechaza notificaciones sin correlación, replay y respuestas retenidas', () => {
    const { challenge, message } = fixture();
    expect(matchesShellyRpcChallenge(challenge, { ...message, retain: true })).toBe(false);
    expect(matchesShellyRpcChallenge(challenge, { ...message, receivedAtMs: 999 })).toBe(false);
    expect(matchesShellyRpcChallenge(challenge, { ...message, receivedAtMs: 16001 })).toBe(false);
    expect(matchesShellyRpcChallenge(challenge, { ...message, topic: `${id}/status/switch:0` })).toBe(false);
    expect(matchesShellyRpcChallenge(challenge, { ...message, payload: JSON.stringify({ id: 'otro' }) })).toBe(false);
  });

  it('rechaza respuestas de otra identidad, otro destino o firmware/modelo incompatible', () => {
    const { challenge, message } = fixture();
    const data = JSON.parse(message.payload) as Record<string, unknown>;
    const variants = [
      { ...data, src: 'shelly1pmg4-other' },
      { ...data, dst: 'otro/destino' },
      { ...data, result: { id: 'otro', model: 'S4SW-001P16EU', gen: 4 } },
      { ...data, result: { id, model: 'OTRO', gen: 4 } },
      { ...data, result: { id, model: 'S4SW-001P16EU', gen: 3 } },
      { ...data, error: { code: -1 } },
      { ...data, params: { id } },
    ];
    for (const item of variants) {
      expect(matchesShellyRpcChallenge(challenge, { ...message, payload: JSON.stringify(item) })).toBe(false);
    }
  });

  it('rechaza JSON corrupto o respuestas demasiado grandes', () => {
    const { challenge, message } = fixture();
    expect(matchesShellyRpcChallenge(challenge, { ...message, payload: '{' })).toBe(false);
    expect(matchesShellyRpcChallenge(challenge, { ...message, payload: 'a'.repeat(8193) })).toBe(false);
  });

  it('exige conexión identificada y rol exclusivo en el snapshot Mosquitto', () => {
    const binding = { username: 'shd_test', clientId: 'shd-test', roleName: 'role_shd_test' };
    const snapshot = {
      ...binding,
      disabled: false,
      roleNames: ['role_shd_test'],
      authenticatedConnectionCount: 1,
    };
    expect(matchesBrokerIdentityConnection(snapshot, binding)).toBe(true);
    expect(matchesBrokerIdentityConnection(null, binding)).toBe(false);
    expect(matchesBrokerIdentityConnection({ ...snapshot, disabled: true }, binding)).toBe(false);
    expect(matchesBrokerIdentityConnection({ ...snapshot, authenticatedConnectionCount: null }, binding)).toBe(false);
    expect(matchesBrokerIdentityConnection({ ...snapshot, authenticatedConnectionCount: 0 }, binding)).toBe(false);
    expect(matchesBrokerIdentityConnection({ ...snapshot, roleNames: ['role_shd_test', 'admin'] }, binding)).toBe(false);
    expect(matchesBrokerIdentityConnection({ ...snapshot, clientId: 'otro' }, binding)).toBe(false);
    expect(matchesBrokerIdentityConnection({ ...snapshot, username: 'otro' }, binding)).toBe(false);
  });
});
