import { ShellyMqttEnableCoordinator, type MqttEnableClaim, type MqttEnablePort } from './shelly-mqtt-enable.coordinator';
import { MqttTopicContract } from '../../infrastructure/messaging/mqtt-topic-contract';

const OP='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESS='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const suffix=ID.replace(/-/g,'');
const claim:MqttEnableClaim={operationId:OP,leaseToken:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  identityId:ID,username:`shd_${suffix}`,clientId:`shd-${suffix}`,
  roleName:`role_shd_${suffix}`,leaseUntil:new Date(Date.now()+60_000)};
const request={userId:USER,homeId:'ffffffff-ffff-4fff-8fff-ffffffffffff',
  sessionId:SESS,sessionToken:'a'.repeat(43),operationId:OP,
  localConfigurationReadbackVerified:true,explicitlyTrustedLocalNetwork:true};
function fixture(profile: 'local-dev'|'vps-dev-tls'='local-dev') {
  const session={sessionId:SESS,homeId:request.homeId,status:'DEVICE_IDENTIFIED',
    expiresAt:new Date(Date.now()+120000).toISOString(),identity:{modelCode:'S4SW-001P16EU',
      generation:4,manufacturerDeviceId:'shelly1pmg4-abcdef123456',
      verification:'MOBILE_REPORTED_UNVERIFIED'}};
  const sessions={
    assertCanManageHome:jest.fn(() => Promise.resolve(undefined)),
    get:jest.fn(() => Promise.resolve(session)),
  };
  const port={request:jest.fn(() => Promise.resolve(undefined)),
    claim:jest.fn(() => Promise.resolve(claim)),
    confirm:jest.fn(() => Promise.resolve(undefined)),
    uncertain:jest.fn(() => Promise.resolve(undefined))} satisfies MqttEnablePort;
  const broker={verifyPreparedDisabled:jest.fn(() => Promise.resolve(undefined)),
    enableIdentity:jest.fn(() => Promise.resolve(undefined)),
    disableIdentity:jest.fn(() => Promise.resolve(undefined)),
    inspectIdentity:jest.fn(() => Promise.resolve({
      username:claim.username,clientId:claim.clientId,disabled:false,
      roleNames:[claim.roleName],authenticatedConnectionCount:null}))};
  const topics = new MqttTopicContract({namespace:'smarthome', devicePrefix:'smarthome/devices',
    switchId:0,tls:true,rpcSource:'smarthome/backend'});
  const runtime={topics,config:{switchId:0}};
  const coordinator = new ShellyMqttEnableCoordinator(
    sessions as never,port,broker,runtime as never,profile,
  );
  return {coordinator,sessions,port,broker,session};
}
describe('Etapa 2: habilitacion cercada, nunca conexion autentica inferida',()=>{
  test('rechaza permiso LAN o readback faltante antes de tocar SQL/broker',async()=>{
    const f=fixture();
    await expect(f.coordinator.enable({...request,localConfigurationReadbackVerified:false})).rejects.toThrow();
    expect(f.port.request).not.toHaveBeenCalled(); expect(f.broker.enableIdentity).not.toHaveBeenCalled();
  });
  test('rechaza sesion expirada sin reclamar lease',async()=>{
    const f=fixture(); f.session.expiresAt=new Date(Date.now()-2000).toISOString();
    await expect(f.coordinator.enable(request)).rejects.toThrow('MQTT_ENABLE_SESSION_NOT_AUTHORIZED');
    expect(f.port.claim).not.toHaveBeenCalled();
  });
  test('habilita la cuenta exacta y termina solo en AWAITING_AUTH',async()=>{
    const f=fixture();
    await expect(f.coordinator.enable(request)).resolves.toEqual({
      phase:'AWAITING_MQTT_AUTH',mqttAuthenticated:false});
    expect(f.broker.verifyPreparedDisabled).toHaveBeenCalledTimes(1);
    expect(f.broker.enableIdentity).toHaveBeenCalledWith(claim.username);
    expect(f.port.confirm).toHaveBeenCalledTimes(1); expect(f.port.uncertain).not.toHaveBeenCalled();
  });
  test('VPS DEV no exige confirmación local y vuelve a validar OWNER antes de SQL',async()=>{
    const f=fixture('vps-dev-tls');
    const vpsRequest={userId:request.userId,homeId:request.homeId,
      sessionId:request.sessionId,sessionToken:request.sessionToken,
      operationId:request.operationId};
    await expect(f.coordinator.enable(vpsRequest)).resolves.toEqual({
      phase:'AWAITING_MQTT_AUTH',mqttAuthenticated:false,
    });
    expect(f.sessions.assertCanManageHome).toHaveBeenCalledTimes(2);
    expect(f.port.request).toHaveBeenCalledWith(OP,USER,request.sessionToken);
  });
  test('un broker incierto manda lease a reconciliacion sin declarar exito',async()=>{
    const f=fixture();f.broker.enableIdentity.mockRejectedValueOnce(new Error('timeout'));
    await expect(f.coordinator.enable(request)).rejects.toThrow('RECONCILIATION');
    expect(f.broker.disableIdentity).toHaveBeenCalledWith(claim.username);
    expect(f.port.uncertain).toHaveBeenCalledTimes(1);expect(f.port.confirm).not.toHaveBeenCalled();
  });
  test('un nombre de identidad distinto bloquea la activacion',async()=>{
    const f=fixture();f.port.claim.mockResolvedValueOnce({...claim,username:'wrong'});
    await expect(f.coordinator.enable(request)).rejects.toThrow('BINDING_MISMATCH');
    expect(f.broker.enableIdentity).not.toHaveBeenCalled();expect(f.port.uncertain).toHaveBeenCalledTimes(1);
  });
  test('un confirm SQL incierto no repite enable y marca la operacion incierta',async()=>{
    const f=fixture();f.port.confirm.mockRejectedValueOnce(new Error('SQL COMMIT timeout'));
    await expect(f.coordinator.enable(request)).rejects.toThrow('RECONCILIATION');
    expect(f.broker.enableIdentity).toHaveBeenCalledTimes(1); expect(f.port.uncertain).toHaveBeenCalledTimes(1);
    expect(f.broker.disableIdentity).toHaveBeenCalledWith(claim.username);
  });
});
