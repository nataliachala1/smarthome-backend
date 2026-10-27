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
  it('reserva exclusivamente el scope derivado y revalida la sesion', async () => {
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
    'rechaza una sesion en estado %s antes de reservar', async (status) => {
    const { coordinator, reserve } = harness({ ...session, status });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_SESSION_NOT_RESERVABLE');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rechaza un modelo incompatible antes de reservar', async () => {
    const { coordinator, reserve } = harness({
      ...session, identity: { ...session.identity, modelCode: 'INVALID' },
    });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_SESSION_NOT_RESERVABLE');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rechaza una sesion caducada antes de reservar', async () => {
    const { coordinator, reserve } = harness({
      ...session, expiresAt: new Date(Date.now() - 1000),
    });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_SESSION_NOT_RESERVABLE');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('rechaza cuando el hogar de la sesion no coincide', async () => {
    const { coordinator, reserve } = harness({ ...session, homeId: 'home-2' });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_SESSION_NOT_RESERVABLE');
    expect(reserve).not.toHaveBeenCalled();
  });

  it('no reserva si falla la validacion del token o la autorizacion OWNER', async () => {
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

  it('rechaza nombres del broker que no coinciden con el id de identidad', async () => {
    const { coordinator, reserve } = harness();
    reserve.mockResolvedValueOnce({ ...reserved, username: 'shd_otro' });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_RESERVATION_BINDING_INVALID');
  });

  it('rechaza una identidad UUID mal formada', async () => {
    const { coordinator, reserve } = harness();
    reserve.mockResolvedValueOnce({ ...reserved, identityId: 'otra-identidad' });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_RESERVATION_BINDING_INVALID');
  });

  it('vuelve a comprobar la autorizacion despues de escribir la reserva', async () => {
    const { coordinator, get } = harness();
    get.mockResolvedValueOnce(session).mockRejectedValueOnce(new Error('HOME_OWNER_REQUIRED'));
    await expect(coordinator.reserve(request)).rejects.toThrow('HOME_OWNER_REQUIRED');
  });

  it('falla cerrado si la sesion cambia despues de la reserva', async () => {
    const { coordinator, get } = harness();
    get.mockResolvedValueOnce(session).mockResolvedValueOnce({ ...session, status: 'CANCELLED' });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_SESSION_NOT_RESERVABLE');
  });

  it('rechaza el id fisico de otro equipo despues de reservar', async () => {
    const { coordinator, get } = harness();
    get.mockResolvedValueOnce(session).mockResolvedValueOnce({
      ...session,
      identity: { ...session.identity, manufacturerDeviceId: 'shelly1pmg4-other' },
    });
    await expect(coordinator.reserve(request)).rejects.toThrow('SHELLY_MQTT_SESSION_CHANGED');
  });
});
