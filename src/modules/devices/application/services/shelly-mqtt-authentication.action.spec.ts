import { ShellyMqttAuthenticationAction } from './shelly-mqtt-authentication.action';

const USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const HOME = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN = 'a'.repeat(43);
const DEVICE = 'shelly1pmg4-abcdef123456';

const request = {
  userId: USER,
  homeId: HOME,
  sessionId: SESSION,
  sessionToken: TOKEN,
  operationId: OP,
};

function fixture(status = 'WAITING_FOR_MQTT') {
  const session = {
    sessionId: SESSION,
    homeId: HOME,
    status,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    identity: {
      modelCode: 'S4SW-001P16EU',
      generation: 4,
      manufacturerDeviceId: DEVICE,
      verification: 'MOBILE_REPORTED_UNVERIFIED',
    },
  };
  const sessions = {
    assertCanManageHome: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(session),
  };
  const confirm = jest.fn<
    Promise<{ phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED' }>,
    [string, string]
  >().mockImplementation(() => {
      session.status = 'CONNECTED';
      return Promise.resolve({ phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED' });
    });
  const worker = { confirm };
  return {
    action: new ShellyMqttAuthenticationAction(sessions, worker),
    sessions,
    worker,
    session,
  };
}

describe('ShellyMqttAuthenticationAction', () => {
  it('autoriza OWNER y token, llama worker con identidad de sesión y relee CONNECTED', async () => {
    const f = fixture();
    await expect(f.action.confirm(request)).resolves.toEqual({
      phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED',
      mqttAuthenticated: true,
    });
    expect(f.sessions.assertCanManageHome).toHaveBeenCalledTimes(2);
    expect(f.worker.confirm).toHaveBeenCalledWith(OP, DEVICE);
    expect(f.sessions.get).toHaveBeenCalledTimes(2);
  });

  it('no vuelve a ejecutar el desafío si CONNECTED ya quedó persistido', async () => {
    const f = fixture('CONNECTED');
    await expect(f.action.confirm(request)).resolves.toMatchObject({
      mqttAuthenticated: true,
      alreadyConfirmed: true,
    });
    expect(f.worker.confirm).not.toHaveBeenCalled();
  });

  it('responde de forma idempotente después de COMPLETED sin reabrir el broker', async () => {
    const f = fixture('COMPLETED');
    f.session.expiresAt = new Date(Date.now() - 1).toISOString();
    await expect(f.action.confirm(request)).resolves.toEqual({
      phase: 'PAIRING_ALREADY_COMPLETED',
      mqttAuthenticated: true,
      alreadyConfirmed: true,
    });
    expect(f.worker.confirm).not.toHaveBeenCalled();
  });

  it('rechaza acceso sin autorización de hogar antes de invocar el worker', async () => {
    const f = fixture();
    f.sessions.assertCanManageHome.mockRejectedValueOnce(new Error('not owner'));
    await expect(f.action.confirm(request)).rejects.toThrow('not owner');
    expect(f.sessions.get).not.toHaveBeenCalled();
    expect(f.worker.confirm).not.toHaveBeenCalled();
  });

  it('rechaza token, UUID, expiración y estado no elegible sin prueba MQTT', async () => {
    const f = fixture();
    await expect(f.action.confirm({ ...request, sessionToken: 'bad' }))
      .rejects.toThrow('REQUEST_INVALID');
    await expect(f.action.confirm({ ...request, operationId: 'bad' }))
      .rejects.toThrow('REQUEST_INVALID');
    f.session.expiresAt = new Date(Date.now() - 1).toISOString();
    await expect(f.action.confirm(request)).rejects.toThrow('SESSION_NOT_ACTIVE');
    expect(f.worker.confirm).not.toHaveBeenCalled();
  });

  it('no afirma CONNECTED si SQL no persiste la confirmación', async () => {
    const f = fixture();
    f.worker.confirm.mockResolvedValueOnce({
      phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED',
    });
    await expect(f.action.confirm(request)).rejects.toThrow('PERSISTENCE_UNCERTAIN');
  });

  it('propaga el resultado incierto para que el controller lo sanitice', async () => {
    const f = fixture();
    f.worker.confirm.mockRejectedValueOnce(new Error('broker/SQL secret detail'));
    await expect(f.action.confirm(request)).rejects.toThrow('broker/SQL secret detail');
    expect(f.sessions.get).toHaveBeenCalledTimes(1);
  });
});
