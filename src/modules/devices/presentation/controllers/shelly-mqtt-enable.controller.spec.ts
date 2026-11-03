// Prueba unitaria del controlador: evita cargar el guard real y sus dependencias ESM.
// El guard JWT real NO se modifica y sigue aplicado al endpoint en produccion.
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

describe('Etapa2: enable HTTP dev no confunde readback con autenticacion', () => {
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

  it('rechaza el runtime no autorizado sin llamar al broker',async () => {
    process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP='false';
    await expect(controller.enable(actor,home,session,token,consent,input)).rejects.toThrow();
    expect(enable).not.toHaveBeenCalled();
  });
  it('rechaza una respuesta móvil sin readback',async () => {
    await expect(controller.enable(actor,home,session,token,consent,
      {...input,localConfigurationReadbackVerified:false})).rejects.toThrow();
    expect(enable).not.toHaveBeenCalled();
  });
  it('envía sesión y JWT al coordinador; el éxito solo es AWAITING_AUTH',async () => {
    enable.mockResolvedValue({phase:'AWAITING_MQTT_AUTH',mqttAuthenticated:false});
    await expect(controller.enable(actor,home,session,token,consent,input))
      .resolves.toEqual({phase:'AWAITING_MQTT_AUTH',mqttAuthenticated:false});
    expect(enable).toHaveBeenCalledWith({
      userId:actor.userId,homeId:home,sessionId:session,sessionToken:token,
      operationId,localConfigurationReadbackVerified:true,explicitlyTrustedLocalNetwork:true,
    });
  });
  it('acepta VPS DEV sin header ni readback local y no declara MQTT autenticado',async()=>{
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
  it('acepta producción únicamente cuando el plan completo registra su worker de autenticación', async () => {
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
  it('un resultado incierto se entrega como error sanitario, no éxito',async () => {
    enable.mockRejectedValue(new Error('raw broker secret'));
    await expect(controller.enable(actor,home,session,token,consent,input))
      .rejects.toHaveProperty('status', 503);
  });
});
