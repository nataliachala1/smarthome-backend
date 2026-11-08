import { ShellyMqttPrepareAction } from './shelly-mqtt-prepare.action';
import type { ShellyReservationRequest } from './shelly-mqtt-reservation.coordinator';

const request: ShellyReservationRequest = {
  userId: 'user-test',
  homeId: 'home-test',
  sessionId: 'session-test',
  sessionToken: 'token-test',
};
const reserved = {
  phase: 'RESERVED_ONLY' as const,
  operationId: 'operation-test',
  identityId: 'identity-test',
  username: 'secret-username',
  clientId: 'secret-clientid',
  roleName: 'secret-role',
  plan: {manufacturerDeviceId:'shelly-id',topicScope:'scope',acls:[]},
};

describe('50410 MQTT preparation action, without broker or database', () => {
  it('only exposes the state and operation ID; never a password or identity to Android', async () => {
    const reserve = jest.fn().mockResolvedValue(reserved);
    const prepare = jest.fn().mockResolvedValue({
      phase: 'PREPARED_DISABLED_ONLY', operationId: 'operation-test',
    });
    const action = new ShellyMqttPrepareAction(
      { reserve }, { prepare },
    );
    const result = await action.execute(request);
    expect(reserve).toHaveBeenCalledWith(request);
    expect(prepare).toHaveBeenCalledWith(reserved);
    expect(result).toEqual({
      phase: 'PREPARED_DISABLED_ONLY',
      operationId: 'operation-test',
      credentialsDelivered: false,
      mqttAuthenticated: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|password|identity-test/);
  });

  it('no declara exito si broker/SQL dan resultado incierto', async () => {
    const reserve = jest.fn().mockResolvedValue(reserved);
    const prepare = jest.fn().mockRejectedValue(new Error('MQTT_PREPARATION_OUTCOME_REQUIRES_RECONCILIATION'));
    const action = new ShellyMqttPrepareAction(
      { reserve }, { prepare },
    );
    await expect(action.execute(request)).rejects.toThrow(
      'MQTT_PREPARATION_OUTCOME_REQUIRES_RECONCILIATION',
    );
  });

  it('rejects an inconsistent operation identifier', async () => {
    const action = new ShellyMqttPrepareAction(
      { reserve: jest.fn().mockResolvedValue(reserved) },
      { prepare: jest.fn().mockResolvedValue({ phase:'PREPARED_DISABLED_ONLY', operationId:'otro' }) },
    );
    await expect(action.execute(request)).rejects.toThrow('MQTT_PREPARE_RESULT_INVALID');
  });
});
