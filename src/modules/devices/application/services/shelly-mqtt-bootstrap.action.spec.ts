import { randomBytes,createCipheriv } from 'node:crypto';
import { writeFileSync,unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellyMqttBootstrapAction } from './shelly-mqtt-bootstrap.action';
const OP='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SES='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOME='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const devId='shelly1pmg4-abcdef123456';
const ID='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const suffix=ID.replace(/-/g,'');
const KEY=randomBytes(32); const PW=randomBytes(32).toString('base64url');
const token='a'.repeat(64);
const keyId='dev-mqtt-aes-v1';
const nonce=randomBytes(12);
const cipher=createCipheriv('aes-256-gcm',KEY,nonce);
cipher.setAAD(Buffer.from(`smarthome:mqtt:preparation-password:v1:${keyId}:${OP}`));
const ciphertext=Buffer.concat([cipher.update(PW,'utf8'),cipher.final()]);
const envelope={ operationId:OP,identityId:ID,manufacturerDeviceId:devId,username:`shd_${suffix}`,
  clientId:`shd-${suffix}`,topicScope:`smarthome/devices/${devId}`,formatVersion:1,keyId,
  nonce:nonce.toString('base64url'),ciphertext:ciphertext.toString('base64url'),
  authTag:cipher.getAuthTag().toString('base64url'),
  expiresAt:new Date(Date.now()+300000).toISOString()};
const input={userId:USER,homeId:HOME,sessionId:SES,sessionToken:token,
  operationId:OP,labTrustConfirmed:true};
const caFile=join(tmpdir(),`smarthome-${process.pid}-dummy-ca.pem`);
// Crypto test requires an actual X509 cert; security validation fails closed on dummy CA.
const session={sessionId:SES,homeId:HOME,status:'DEVICE_IDENTIFIED',
  expiresAt:new Date(Date.now()+300000).toISOString(),identity:{modelCode:'S4SW-001P16EU',
    manufacturerDeviceId:devId}};
function fixture(){
  const sessions={get:jest.fn().mockResolvedValue(session)};
  const secrets={load:jest.fn().mockResolvedValue(envelope)};
  const runtime={config:{brokerUrl:'mqtts://192.168.1.24:8883',tls:true,caFile}};
  return {sessions,secrets,action:new ShellyMqttBootstrapAction(
    sessions,secrets,runtime as never,KEY.toString('base64url'),keyId,caFile)};
}
describe('Bootstrap 031 - sin secretos antes de permisos SQL',()=>{
  beforeAll(()=>writeFileSync(caFile,'invalidCA'));
  afterAll(()=>unlinkSync(caFile));
  const prev=process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP, previous=process.env.NODE_ENV;
  beforeEach(()=>{process.env.NODE_ENV='development'; delete process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP;});
  afterAll(()=>{if(prev===undefined) delete process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP;
    else process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP=prev;
    if(previous===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=previous;});
  test('sin doble aprobacion no lee secretos',async()=>{
    const f=fixture();await expect(f.action.authorize(input)).rejects.toThrow('TRUST_REQUIRED');
    expect(f.secrets.load).not.toHaveBeenCalled();
  });
  test('requiere sesion activa sin siquiera leer SQL031',async()=>{
    process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP='true';
    const f=fixture();f.sessions.get.mockResolvedValue({...session,status:'EXPIRED'});
    await expect(f.action.authorize(input)).rejects.toThrow('SESSION_NOT_AUTHORIZED');
    expect(f.secrets.load).not.toHaveBeenCalled();
  });
  test('no acepta operacion que difiere de la session',async()=>{
    process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP='true';
    const f=fixture();f.secrets.load.mockResolvedValue({...envelope,manufacturerDeviceId:'shelly1pmg4-wrong'});
    await expect(f.action.authorize(input)).rejects.toThrow('BINDING_INVALID');
  });
  test('bloquea CA inválida incluso con envelope correcto',async()=>{
    process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP='true';
    const f=fixture();await expect(f.action.authorize(input)).rejects.toThrow('CA_INVALID');
  });
  test('descifra envelope AES-GCM y regresa identidad exclusiva, sin activar MQTT',async()=>{
    process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP='true';
    writeFileSync(caFile,'-----BEGIN CERTIFICATE-----\nMIIDGTCCAgGgAwIBAgIUEO530HzhOyy8WCZtZU7VXppEL4QwDQYJKoZIhvcNAQEL\nBQAwHDEaMBgGA1UEAwwRU21hcnRIb21lIFRlc3QgQ0EwHhcNMjYxMDI2MTgxNTIz\nWhcNMzYxMDIzMTgxNTIzWjAcMRowGAYDVQQDDBFTbWFydEhvbWUgVGVzdCBDQTCC\nASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALjRQlev3vqL7P3xE3qxL9BP\nure6D/v+0Z1wzU0BESqYQ6NTKcWvzQrt5NPXvkUniTqfS6BmzvaI8fBtL16jYRo2\nUqItQnkRAK7Hv+OXLPScsyNChnYWEragLf6ypmdxIPPaSnZZT5kUDyReSFcepl7s\nNctD/ijY4lKBvGcIoF4E6aOJdEAta8wXoNJYRVPNORTmPMGU4xm+OoEHl8dLLcbx\n21nYgF6dREvQgY3SJR67n/yXKfNAADwU3G/9T097+lZTy0jqspQae1W3+Hdskc7X\nVspIC1Ev8eBh8tEXyTkwowwkz4/9LI/g+yOxoKY89ZveZYprl2XKRBJg5gxwPR8C\nAwEAAaNTMFEwHQYDVR0OBBYEFFB/5X71RcuPQdcWbcUAn1uhYFrFMB8GA1UdIwQY\nMBaAFFB/5X71RcuPQdcWbcUAn1uhYFrFMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZI\nhvcNAQELBQADggEBAGhGChiBOmCeI8vfdbBwch4URVL8gAxpiNHW0pzARzN1IVzr\nCnjQx8R+pEo+tCl7rw6nYVTdX+DuA5MaOxHi+YTTdZ9V9WsqSfaTeEKDRXAreduT\nus4lBAs+V72dp+BMRbVFJecbJvX8+cg4i4j5hCBla9Y3MxHgeCFwqqq0JSoXix7n\nfLapzK0TIQs8n1zow8MiHcFO6k/lC60Nk7/q1Zvly5Qg72/lO8Cm2j/ZSQfz3oku\n+Sz7LKm6ROKfM+Fdn3XToXs8H/GtD5r0Yv3LghPXGd2YkPki6jTG2BgSprx2qVCb\nJDH+bkGuJ0yK9Y0n1CBtZob5RFcf8tMOdbhhFXY=\n-----END CERTIFICATE-----');
    try {
      const f=fixture();
      const result=await f.action.authorize(input);
      expect(result.phase).toBe('PROVISIONING_AUTHORIZED');
      expect(result.manufacturerDeviceId).toBe(devId);
      expect(result.identity.username).toBe(`shd_${suffix}`);
      expect(result.identity.password).toBe(PW);
      expect(result.broker.hostname).toBe('192.168.1.24');
      expect(f.secrets.load).toHaveBeenCalledTimes(1);
      expect(f.sessions.get).toHaveBeenCalledTimes(2);
    } finally {writeFileSync(caFile,'invalidCA');}
  });
  test('tokens no hexadecimales bloqueados antes de DB',async()=>{
    process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP='true';
    const f=fixture();await expect(f.action.authorize({...input,sessionToken:'abc'})).rejects.toThrow('TRUST_REQUIRED');
    expect(f.secrets.load).not.toHaveBeenCalled();
  });
});
