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
  it('authorizes OWNER and token, calls the worker with the session identity and re-reads CONNECTED', async () => {
    const f = fixture();
    await expect(f.action.confirm(request)).resolves.toEqual({
      phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED',
      mqttAuthenticated: true,
    });
    expect(f.sessions.assertCanManageHome).toHaveBeenCalledTimes(2);
    expect(f.worker.confirm).toHaveBeenCalledWith(OP, DEVICE);
    expect(f.sessions.get).toHaveBeenCalledTimes(2);
  });

  it('does not run the challenge again if CONNECTED is already persisted', async () => {
    const f = fixture('CONNECTED');
    await expect(f.action.confirm(request)).resolves.toMatchObject({
      mqttAuthenticated: true,
      alreadyConfirmed: true,
    });
    expect(f.worker.confirm).not.toHaveBeenCalled();
  });

  it('responds idempotently after COMPLETED without reopening the broker', async () => {
    const f = fixture('COMPLETED');
    f.session.expiresAt = new Date(Date.now() - 1).toISOString();
    await expect(f.action.confirm(request)).resolves.toEqual({
      phase: 'PAIRING_ALREADY_COMPLETED',
      mqttAuthenticated: true,
      alreadyConfirmed: true,
    });
    expect(f.worker.confirm).not.toHaveBeenCalled();
  });

  it('rejects access without home authorization before invoking the worker', async () => {
    const f = fixture();
    f.sessions.assertCanManageHome.mockRejectedValueOnce(new Error('not owner'));
    await expect(f.action.confirm(request)).rejects.toThrow('not owner');
    expect(f.sessions.get).not.toHaveBeenCalled();
    expect(f.worker.confirm).not.toHaveBeenCalled();
  });

  it('rejects a token, UUID, expiration and ineligible state without an MQTT proof', async () => {
    const f = fixture();
    await expect(f.action.confirm({ ...request, sessionToken: 'bad' }))
      .rejects.toThrow('REQUEST_INVALID');
    await expect(f.action.confirm({ ...request, operationId: 'bad' }))
      .rejects.toThrow('REQUEST_INVALID');
    f.session.expiresAt = new Date(Date.now() - 1).toISOString();
    await expect(f.action.confirm(request)).rejects.toThrow('SESSION_NOT_ACTIVE');
    expect(f.worker.confirm).not.toHaveBeenCalled();
  });

  it('does not claim CONNECTED if SQL does not persist the confirmation', async () => {
    const f = fixture();
    f.worker.confirm.mockResolvedValueOnce({
      phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED',
    });
    await expect(f.action.confirm(request)).rejects.toThrow('PERSISTENCE_UNCERTAIN');
  });

  it('propagates the uncertain result so that the controller sanitizes it', async () => {
    const f = fixture();
    f.worker.confirm.mockRejectedValueOnce(new Error('broker/SQL secret detail'));
    await expect(f.action.confirm(request)).rejects.toThrow('broker/SQL secret detail');
    expect(f.sessions.get).toHaveBeenCalledTimes(1);
  });
});
