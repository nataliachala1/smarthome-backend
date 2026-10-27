import { HttpException } from '@nestjs/common';
jest.mock('../../../auth/presentation/http/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuardMock {},
}));
import { ShellyMqttBootstrapController } from './shelly-mqtt-bootstrap.controller';

const USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOME = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SESSION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OPERATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN = 'a'.repeat(43);

describe('ShellyMqttBootstrapController', () => {
  it('acepta el request VPS sin exigir el header exclusivo del laboratorio', async () => {
    const result = { phase: 'PROVISIONING_AUTHORIZED', mqttAuthenticated: false };
    const action = { authorize: jest.fn().mockResolvedValue(result) };
    const controller = new ShellyMqttBootstrapController(action as never);

    await expect(controller.authorize(
      { userId: USER } as never,
      HOME,
      SESSION,
      TOKEN,
      undefined,
      { operationId: OPERATION },
    )).resolves.toEqual(result);

    expect(action.authorize).toHaveBeenCalledWith({
      userId: USER,
      homeId: HOME,
      sessionId: SESSION,
      sessionToken: TOKEN,
      operationId: OPERATION,
      labTrustConfirmed: false,
    });
  });

  it('sanitiza errores internos sin propagar secretos ni mensajes SQL', async () => {
    const action = {
      authorize: jest.fn().mockRejectedValue(
        new Error('private broker password or SQL detail'),
      ),
    };
    const controller = new ShellyMqttBootstrapController(action as never);

    try {
      await controller.authorize(
        { userId: USER } as never,
        HOME,
        SESSION,
        TOKEN,
        undefined,
        { operationId: OPERATION },
      );
      throw new Error('EXPECTED_REJECTION');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as Error).message).not.toContain('private broker password');
      expect((error as HttpException).getResponse()).toEqual({
        code: 'MQTT_BOOTSTRAP_NOT_AUTHORIZED_OR_UNCERTAIN',
      });
    }
  });
});
