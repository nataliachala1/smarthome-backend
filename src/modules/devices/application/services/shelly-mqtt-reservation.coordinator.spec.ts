import { createHash } from 'node:crypto';
import { parseMqttConfig } from '../../../../config/mqtt-config';
import { MqttTopicContract } from '../../infrastructure/messaging/mqtt-topic-contract';
import {
  ShellyMqttReservationCoordinator,
  type ShellyReservationRequest,
} from './shelly-mqtt-reservation.coordinator';

const identityId = '1e3c51b2-4f8a-4c3e-9a24-0acc5bf55e21';
const operationId = 'cb3c2441-6290-46d3-88d7-13e141c1f421';
const physicalId = 'shelly1pmg4-aabbccddeeff';
const scope = physicalId;
const suffix = identityId.replace(/-/g, '');
const request: ShellyReservationRequest = {
  userId: 'user-1',
  homeId: 'home-1',
  sessionId: 'session-1',
  sessionToken: 'never-log-this-session-token',
};
const session = {
  sessionId: request.sessionId,
  homeId: request.homeId,
  status: 'DEVICE_IDENTIFIED',
  expiresAt: new Date(Date.now() + 60_000),
  identity: {
    manufacturerDeviceId: physicalId,
    modelCode: 'S4SW-001P16EU',
    generation: 4,
    verification: 'MOBILE_REPORTED_UNVERIFIED',
  },
};
const reserved = {
  operationId,
  identityId,
  username: `shd_${suffix}`,
  clientId: `shd-${suffix}`,
  roleName: `role_shd_${suffix}`,
  reservedTopicScope: scope,
};

function harness(initial = session) {
  const get = jest.fn().mockResolvedValue(initial);
  const reserve = jest.fn().mockResolvedValue(reserved);
  const config = parseMqttConfig({ NODE_ENV: 'test' });
  const coordinator = new ShellyMqttReservationCoordinator(
    { get },
    { reserve },
    { topics: new MqttTopicContract(config), config },
  );
  return { coordinator, get, reserve };
}

describe('ShellyMqttReservationCoordinator / reserva solamente', () => {
  it('reserves different Shellys in parallel with isolated bindings and topics', async () => {
    const otherIdentityId = 'd49c6fde-3783-4a0b-bfe6-8aca63788e78';
    const otherOperationId = '489d18c2-0872-49db-82db-d96943854687';
    const otherPhysicalId = 'shelly1pmg4-112233aabbcc';
    const otherSession = {
      ...session,
      sessionId: 'other-session',
      identity: { ...session.identity, manufacturerDeviceId: otherPhysicalId },
    };
    const otherReserved = {
      operationId: otherOperationId,
      identityId: otherIdentityId,
      username: `shd_${otherIdentityId.replace(/-/g, '')}`,
      clientId: `shd-${otherIdentityId.replace(/-/g, '')}`,
      roleName: `role_shd_${otherIdentityId.replace(/-/g, '')}`,
      reservedTopicScope: otherPhysicalId,
    };
    const first = harness(session);
    const second = harness(otherSession);
    second.reserve.mockResolvedValue(otherReserved);

    const [firstResult, secondResult] = await Promise.all([
      first.coordinator.reserve(request),
      second.coordinator.reserve({ ...request, sessionId: 'other-session' }),
    ]);

    expect(firstResult.username).not.toBe(secondResult.username);
    expect(firstResult.clientId).not.toBe(secondResult.clientId);
    expect(firstResult.roleName).not.toBe(secondResult.roleName);
    expect(firstResult.plan.topicScope).not.toBe(secondResult.plan.topicScope);
    const firstTopics = new Set(firstResult.plan.acls.map((acl) => acl.topic));
    expect(secondResult.plan.acls.some((acl) => firstTopics.has(acl.topic))).toBe(false);
    expect(first.reserve).toHaveBeenCalledTimes(1);
    expect(second.reserve).toHaveBeenCalledTimes(1);
  });

  it('reserves only the derived scope and revalidates the session', async () => {
    const { coordinator, get, reserve } = harness();
    const result = await coordinator.reserve(request);
    expect(result).toMatchObject({ phase: 'RESERVED_ONLY', operationId, identityId });
    expect(result.plan.topicScope).toBe(scope);
    expect(result.plan.acls).toHaveLength(5);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledWith(
      request.sessionId, scope, request.userId,
      createHash('sha256').update(request.sessionToken).digest('hex'),
    );
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith(
      request.userId, request.homeId, request.sessionId, request.sessionToken,
    );
    expect(JSON.stringify(result)).not.toContain(request.sessionToken);
    expect(JSON.stringify(result)).not.toContain('password');
  });

  it.each(['PENDING', 'CONNECTED', 'EXPIRED', 'COMPLETED', 'CANCELLED', 'FAILED'])(
    'rejects a session in state %s before reserving', async (status) => {
    const { coordinator, reserve } = harness({ ...session, status });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_SESSION_NOT_RESERVABLE');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rejects an incompatible model before reserving', async () => {
    const { coordinator, reserve } = harness({
      ...session, identity: { ...session.identity, modelCode: 'INVALID' },
    });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_SESSION_NOT_RESERVABLE');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rejects an expired session before reserving', async () => {
    const { coordinator, reserve } = harness({
      ...session, expiresAt: new Date(Date.now() - 1000),
    });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_SESSION_NOT_RESERVABLE');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rejects when the session home does not match', async () => {
    const { coordinator, reserve } = harness({ ...session, homeId: 'home-2' });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_SESSION_NOT_RESERVABLE');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('does not reserve if the token validation or the OWNER authorization fails', async () => {
    const { coordinator, get, reserve } = harness();
    get.mockRejectedValueOnce(new Error('HOME_OWNER_REQUIRED'));
    await expect(coordinator.reserve(request)).rejects.toThrow('HOME_OWNER_REQUIRED');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rechaza un scope diferente al reservado en PostgreSQL', async () => {
    const { coordinator, reserve } = harness();
    reserve.mockResolvedValueOnce({ ...reserved, reservedTopicScope: 'another/devices/shelly-other' });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_RESERVATION_SCOPE_MISMATCH');
  });

  it('rejects broker names that do not match the identity id', async () => {
    const { coordinator, reserve } = harness();
    reserve.mockResolvedValueOnce({ ...reserved, username: 'shd_otro' });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_RESERVATION_BINDING_INVALID');
  });

  it('rejects a malformed UUID identity', async () => {
    const { coordinator, reserve } = harness();
    reserve.mockResolvedValueOnce({ ...reserved, identityId: 'otra-identidad' });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_RESERVATION_BINDING_INVALID');
  });

  it('checks the authorization again after writing the reservation', async () => {
    const { coordinator, get } = harness();
    get.mockResolvedValueOnce(session).mockRejectedValueOnce(new Error('HOME_OWNER_REQUIRED'));
    await expect(coordinator.reserve(request)).rejects.toThrow('HOME_OWNER_REQUIRED');
  });

  it('fails closed if the session changes after the reservation', async () => {
    const { coordinator, get } = harness();
    get.mockResolvedValueOnce(session).mockResolvedValueOnce({ ...session, status: 'CANCELLED' });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_SESSION_NOT_RESERVABLE');
  });

  it('rejects another device\'s physical id after reserving', async () => {
    const { coordinator, get } = harness();
    get.mockResolvedValueOnce(session).mockResolvedValueOnce({
      ...session,
      identity: { ...session.identity, manufacturerDeviceId: 'shelly1pmg4-other' },
    });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_SESSION_CHANGED');
  });
});
