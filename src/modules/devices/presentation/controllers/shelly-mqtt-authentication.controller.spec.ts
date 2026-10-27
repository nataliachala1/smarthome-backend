import { HttpException } from '@nestjs/common';
jest.mock('../../../auth/presentation/http/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuardMock {},
}));
import { ShellyMqttAuthenticationController } from './shelly-mqtt-authentication.controller';

const USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const HOME = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN = 'a'.repeat(43);

describe('ShellyMqttAuthenticationController', () => {
  const originalEnv = { ...process.env };
  const action = { confirm: jest.fn() };
  const controller = new ShellyMqttAuthenticationController(action as never);

  beforeEach(() => {
    action.confirm.mockReset();
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'development';
    process.env.SHELLY_MQTT_DEV_DI_ENABLED = 'true';
    process.env.SHELLY_MQTT_VPS_DEV_TLS_ENABLED = 'true';
    process.env.SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED = 'true';
    process.env.SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED = 'true';
    process.env.MQTT_ENABLED = 'true';
    process.env.SHELLY_MQTT_AUTH_DEV_DI_ENABLED = 'true';
    process.env.SHELLY_MQTT_VPS_DEV_AUTH_WORKER_ENABLED = 'true';
  });

  afterAll(() => { process.env = originalEnv; });

  it('el móvil solo dispara la prueba; el backend recibe la sesión/token/operación', async () => {
    const result = {
      phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED',
      mqttAuthenticated: true,
    };
    action.confirm.mockResolvedValueOnce(result);
    await expect(controller.confirm(
      { userId: USER } as never,
      HOME,
      SESSION,
      TOKEN,
      { operationId: OP },
    )).resolves.toEqual(result);
    expect(action.confirm).toHaveBeenCalledWith({
      userId: USER,
      homeId: HOME,
      sessionId: SESSION,
      sessionToken: TOKEN,
      operationId: OP,
    });
  });

  it('ignora la información de dispositivo que un cliente pudiera falsear', async () => {
    action.confirm.mockResolvedValueOnce({
      phase: 'MQTT_AUTH_PERSISTED_SESSION_CONNECTED',
      mqttAuthenticated: true,
    });
    await controller.confirm(
      { userId: USER } as never,
      HOME,
      SESSION,
      TOKEN,
      {
        operationId: OP,
        mqttAuthenticated: true,
        deviceInfo: { id: 'shelly1pmg4-forged', model: 'S4SW-001P16EU', gen: 4 },
      },
    );
    expect(action.confirm).toHaveBeenCalledWith({
      userId: USER,
      homeId: HOME,
      operationId: OP,
      sessionId: SESSION,
      sessionToken: TOKEN,
    });
  });

  it('mantiene apagado el endpoint sin el opt-in específico del worker', async () => {
    process.env.SHELLY_MQTT_VPS_DEV_AUTH_WORKER_ENABLED = 'false';
    await expect(controller.confirm(
      { userId: USER } as never, HOME, SESSION, TOKEN, { operationId: OP },
    )).rejects.toHaveProperty('status', 503);
    expect(action.confirm).not.toHaveBeenCalled();
  });

  it('no expone detalles del broker o de SQL si el resultado es incierto', async () => {
    action.confirm.mockRejectedValueOnce(new Error('private SQL password detail'));
    try {
      await controller.confirm(
        { userId: USER } as never, HOME, SESSION, TOKEN, { operationId: OP },
      );
      throw new Error('EXPECTED_REJECTION');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as Error).message).not.toContain('private SQL password');
      expect((error as HttpException).getResponse()).toEqual({
        code: 'MQTT_AUTH_OUTCOME_REQUIRES_RECONCILIATION',
      });
    }
  });
});
