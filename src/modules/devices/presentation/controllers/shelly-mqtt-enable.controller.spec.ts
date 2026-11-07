// Controller unit test: avoids loading the real guard and its ESM dependencies.
// The real JWT guard is NOT modified and still applies to the endpoint in production.
jest.mock('../../../auth/presentation/http/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class MockJwtAuthGuard {
    canActivate() { return true; }
  },
}));
jest.mock('../../infrastructure/messaging/shelly-mqtt-deployment-mode', () => ({
  selectShellyMqttProviderPlan: jest.fn(),
}));

import { ShellyMqttEnableController } from './shelly-mqtt-enable.controller';
import { selectShellyMqttProviderPlan } from '../../infrastructure/messaging/shelly-mqtt-deployment-mode';
import type { ShellyMqttEnableCoordinator } from '../../application/services/shelly-mqtt-enable.coordinator';
import type { AuthenticatedUser } from '../../../auth/domain/types/authenticated-user.type';

describe('Stage 2: dev HTTP enable does not confuse readback with authentication', () => {
  const env = {...process.env};
  const actor: AuthenticatedUser = { userId: 'owner-test', role: 'OWNER' };
  const home = '00000000-0000-4000-8000-000000000001';
  const session = '00000000-0000-4000-8000-000000000002';
  const operationId = '00000000-0000-4000-8000-000000000003';
  const token = 'a'.repeat(43);
  const consent = 'isolated-dev-lan-only';
  const input = {operationId, localConfigurationReadbackVerified:true};
  const enable = jest.fn();
  const controller = new ShellyMqttEnableController({enable} as unknown as ShellyMqttEnableCoordinator);
  beforeEach(() => {
    enable.mockReset();
    (selectShellyMqttProviderPlan as jest.Mock).mockReturnValue({
      vpsAuthWorker: false, productionAuthWorker: false,
    });
    process.env.NODE_ENV='development';
    process.env.SHELLY_MQTT_DEV_DI_ENABLED='true';
    process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP='true';
  });
  afterAll(() => { process.env = env; });

  it('rejects an unauthorized runtime without calling the broker',async () => {
    process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP='false';
    await expect(controller.enable(actor,home,session,token,consent,input)).rejects.toThrow();
    expect(enable).not.toHaveBeenCalled();
  });
  it('rejects a mobile response without readback',async () => {
    await expect(controller.enable(actor,home,session,token,consent,
      {...input,localConfigurationReadbackVerified:false})).rejects.toThrow();
    expect(enable).not.toHaveBeenCalled();
  });
  it('sends the session and JWT to the coordinator; success is only AWAITING_AUTH',async () => {
    enable.mockResolvedValue({phase:'AWAITING_MQTT_AUTH',mqttAuthenticated:false});
    await expect(controller.enable(actor,home,session,token,consent,input))
      .resolves.toEqual({phase:'AWAITING_MQTT_AUTH',mqttAuthenticated:false});
    expect(enable).toHaveBeenCalledWith({
      userId:actor.userId,homeId:home,sessionId:session,sessionToken:token,
      operationId,localConfigurationReadbackVerified:true,explicitlyTrustedLocalNetwork:true,
    });
  });
  it('accepts VPS DEV without the header or local readback and does not declare MQTT authenticated',async()=>{
    (selectShellyMqttProviderPlan as jest.Mock).mockReturnValue({
      vpsAuthWorker: true, productionAuthWorker: false,
    });
    process.env.NODE_ENV='production';
    process.env.APP_ENV='development';
    process.env.SHELLY_MQTT_VPS_DEV_TLS_ENABLED='true';
    process.env.SHELLY_MQTT_VPS_DEV_PAIRING_ENABLED='true';
    process.env.SHELLY_MQTT_VPS_DEV_TRANSPORT_ENABLED='true';
    process.env.MQTT_ENABLED='true';
    process.env.SHELLY_MQTT_AUTH_DEV_DI_ENABLED='true';
    process.env.SHELLY_MQTT_VPS_DEV_AUTH_WORKER_ENABLED='true';
    enable.mockResolvedValue({phase:'AWAITING_MQTT_AUTH',mqttAuthenticated:false});
    await expect(controller.enable(actor,home,session,token,undefined,{operationId}))
      .resolves.toEqual({phase:'AWAITING_MQTT_AUTH',mqttAuthenticated:false});
    expect(enable).toHaveBeenCalledWith({
      userId:actor.userId,homeId:home,sessionId:session,sessionToken:token,operationId,
    });
  });
  it('accepts production only when the full plan registers its authentication worker', async () => {
    process.env.NODE_ENV='production';
    process.env.APP_ENV='production';
    (selectShellyMqttProviderPlan as jest.Mock).mockReturnValue({
      vpsAuthWorker: false, productionAuthWorker: true,
    });
    enable.mockResolvedValue({phase:'AWAITING_MQTT_AUTH',mqttAuthenticated:false});
    await expect(controller.enable(actor,home,session,token,undefined,{operationId}))
      .resolves.toEqual({phase:'AWAITING_MQTT_AUTH',mqttAuthenticated:false});
    expect(enable).toHaveBeenCalledWith({
      userId:actor.userId,homeId:home,sessionId:session,sessionToken:token,operationId,
    });
  });
  it('an uncertain result is returned as a sanitized error, not a success',async () => {
    enable.mockRejectedValue(new Error('raw broker secret'));
    await expect(controller.enable(actor,home,session,token,consent,input))
      .rejects.toHaveProperty('status', 503);
  });
});
