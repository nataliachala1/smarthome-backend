import { parseMqttConfig } from '../../../../config/mqtt-config';
import { MqttTopicContract } from '../../infrastructure/messaging/mqtt-topic-contract';
import { buildShellyMqttAclPlan } from './shelly-mqtt-acl.policy';
import type { ShellyInternalReservation } from './shelly-mqtt-reservation.coordinator';
import { ShellyMqttPreparationCoordinator } from './shelly-mqtt-preparation.coordinator';

const operationId = 'cb3c2441-6290-46d3-88d7-13e141c1f421';
const identityId = '1e3c51b2-4f8a-4c3e-9a24-0acc5bf55e21';
const token = '7ac88c31-cd8e-4c4e-bb2b-82fbbe390384';
const suffix = identityId.replace(/-/g, '');
const topics = new MqttTopicContract(parseMqttConfig({ NODE_ENV: 'test' }));
const reservation: ShellyInternalReservation = {
  phase: 'RESERVED_ONLY', operationId, identityId,
  username: `shd_${suffix}`, clientId: `shd-${suffix}`,
  roleName: `role_shd_${suffix}`,
  plan: buildShellyMqttAclPlan(topics, 'shelly1pmg4-d885acf06990', 0),
};

function harness() {
  const claim = jest.fn().mockResolvedValue({ operationId, leaseToken: token });
  const reportUncertain = jest.fn().mockResolvedValue(undefined);
  const prepareDisabled = jest.fn().mockResolvedValue(undefined);
  const verifyPreparedDisabled = jest.fn().mockResolvedValue(undefined);
  const confirm = jest.fn().mockResolvedValue(undefined);
  const issueOrLoadForOperation = jest.fn().mockResolvedValue('test-only-secret-password-longer-than-32-characters');
  const coordinator = new ShellyMqttPreparationCoordinator(
    { claim, reportUncertain },
    { prepareDisabled, verifyPreparedDisabled },
    { confirm },
    { issueOrLoadForOperation },
  );
  return { coordinator, claim, reportUncertain, prepareDisabled, verifyPreparedDisabled, confirm, issueOrLoadForOperation };
}

describe('ShellyMqttPreparationCoordinator / solo preparado deshabilitado', () => {
  it('prepara -> verifica 5 ACL -> confirma SQL 027 sin habilitar ni exponer password', async () => {
    const h = harness();
    const order: string[] = [];
    h.claim.mockImplementation(() => { order.push('claim'); return Promise.resolve({ operationId, leaseToken: token }); });
    h.prepareDisabled.mockImplementation(() => { order.push('prepare'); return Promise.resolve(undefined); });
    h.verifyPreparedDisabled.mockImplementation(() => { order.push('verify'); return Promise.resolve(undefined); });
    h.confirm.mockImplementation(() => { order.push('confirm'); return Promise.resolve(undefined); });
    await expect(h.coordinator.prepare(reservation)).resolves.toEqual({
      phase: 'PREPARED_DISABLED_ONLY', operationId,
    });
    expect(order).toEqual(['claim', 'prepare', 'verify', 'confirm']);
    expect(h.issueOrLoadForOperation).toHaveBeenCalledWith(operationId, token);
    expect(h.claim).toHaveBeenCalledWith(operationId, 60);
    expect(h.verifyPreparedDisabled).toHaveBeenCalledWith({
      username: reservation.username, clientId: reservation.clientId,
      roleName: reservation.roleName, topicScope: reservation.plan.topicScope,
      acls: reservation.plan.acls,
    });
    expect(h.confirm).toHaveBeenCalledWith({
      operationId, identityId, leaseToken: token,
      username: reservation.username, clientId: reservation.clientId,
      roleName: reservation.roleName,
    });
    expect(JSON.stringify({ phase: 'PREPARED_DISABLED_ONLY', operationId })).not.toContain('test-only-secret-password');
  });

  it('no confirma si el almacen de secretos no proporciona una clave valida', async () => {
    const h = harness();
    h.issueOrLoadForOperation.mockResolvedValueOnce('weak');
    await expect(h.coordinator.prepare(reservation))
      .rejects.toThrow('MQTT_PREPARATION_OUTCOME_REQUIRES_RECONCILIATION');
    expect(h.prepareDisabled).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it('nunca toca el broker si reclamar lease falla', async () => {
    const h = harness();
    h.claim.mockRejectedValueOnce(new Error('lease expired'));
    await expect(h.coordinator.prepare(reservation)).rejects.toThrow('lease expired');
    expect(h.prepareDisabled).not.toHaveBeenCalled();
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it('rechaza reserva invalida antes del claim', async () => {
    const h = harness();
    await expect(h.coordinator.prepare({ ...reservation, plan: {
      ...reservation.plan, acls: reservation.plan.acls.slice(0, 4),
    } })).rejects.toThrow('MQTT_PREPARATION_RESERVATION_INVALID');
    expect(h.claim).not.toHaveBeenCalled();
  });

  it.each(['prepareDisabled', 'verifyPreparedDisabled', 'confirm'] as const)(
    'nunca devuelve exito y solicita reconciliacion si falla %s', async (step) => {
      const h = harness();
      h[step].mockRejectedValueOnce(new Error('unknown broker or sql outcome'));
      await expect(h.coordinator.prepare(reservation))
        .rejects.toThrow('MQTT_PREPARATION_OUTCOME_REQUIRES_RECONCILIATION');
      expect(h.reportUncertain).toHaveBeenCalledWith(operationId, token);
      if (step !== 'confirm') expect(h.confirm).not.toHaveBeenCalled();
    },
  );

  it('no devuelve exito aunque falle reportar resultado incierto', async () => {
    const h = harness();
    h.verifyPreparedDisabled.mockRejectedValueOnce(new Error('timeout'));
    h.reportUncertain.mockRejectedValueOnce(new Error('sql offline'));
    await expect(h.coordinator.prepare(reservation))
      .rejects.toThrow('MQTT_PREPARATION_OUTCOME_REQUIRES_RECONCILIATION');
  });
});
