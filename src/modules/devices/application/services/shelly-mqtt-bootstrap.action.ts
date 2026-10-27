import { createDecipheriv, createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { MqttRuntimeService } from '../../infrastructure/messaging/mqtt-runtime.service';
import type { ShellyPairingSessionService } from './shelly-pairing-session.service';

const isLiveExpiry = (value: Date | string | null | undefined): boolean => {
  const millis = value instanceof Date
    ? value.getTime()
    : typeof value === 'string' ? Date.parse(value) : NaN;

  return Number.isFinite(millis) && millis > Date.now();
};

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAME=/^[A-Za-z0-9_-]{1,128}$/;
const SECRET=/^[A-Za-z0-9_-]{43}$/;
const TOKEN=/^[a-f0-9]{64}$/;
const SCOPE=/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

export interface MqttAuthorizedBootstrapEnvelope {
  operationId:string; identityId:string; manufacturerDeviceId:string; username:string;
  clientId:string; topicScope:string; formatVersion:number; keyId:string;
  nonce:string; ciphertext:string; authTag:string; expiresAt:Date|string;
}
export interface MqttAuthorizedBootstrapPort {
  load(operationId:string, actorId:string, tokenHash:string):Promise<MqttAuthorizedBootstrapEnvelope>;
}
export interface ShellyBootstrapRequest {
  userId:string; homeId:string; sessionId:string;
  sessionToken:string; operationId:string;
  labTrustConfirmed:boolean;
}

/** Sólo laboratorio desarrollo. HTTP/LAN no ofrece privacidad suficiente para producción. */
export class ShellyMqttBootstrapAction {
  private readonly aesKey:Buffer;
  constructor(
    private readonly sessions:Pick<ShellyPairingSessionService,'get'>,
    private readonly secrets:MqttAuthorizedBootstrapPort,
    private readonly runtime:Pick<MqttRuntimeService,'config'>,
    aesKeyB64:string,
    private readonly keyId:string,
    private readonly caFile:string,
  ) {
    if (!SECRET.test(aesKeyB64) || keyId!=='dev-mqtt-aes-v1' || !caFile) {
      throw new Error('MQTT_BOOTSTRAP_KEY_NOT_READY');
    }
    const decoded=Buffer.from(aesKeyB64,'base64url');
    if (decoded.length!==32 || decoded.toString('base64url')!==aesKeyB64) {
      throw new Error('MQTT_BOOTSTRAP_KEY_NOT_READY');
    }
    this.aesKey=decoded;
  }
  async authorize(input:ShellyBootstrapRequest) {
    if (process.env.NODE_ENV!=='development' ||
        process.env.SHELLY_MQTT_TRUSTED_LAB_BOOTSTRAP!=='true' ||
        !input.labTrustConfirmed || !UUID.test(input.sessionId) ||
        !UUID.test(input.operationId) || !TOKEN.test(input.sessionToken)) {
      throw new Error('MQTT_BOOTSTRAP_TRUST_REQUIRED');
    }
    const before=await this.sessions.get(input.userId,input.homeId,input.sessionId,input.sessionToken);
    if (before.sessionId!==input.sessionId || before.homeId!==input.homeId ||
        !['DEVICE_IDENTIFIED','WAITING_FOR_MQTT'].includes(before.status) ||
        before.identity?.modelCode!=='S4SW-001P16EU' ||
        !before.identity.manufacturerDeviceId ||
        !isLiveExpiry(before.expiresAt)) {
      throw new Error('MQTT_BOOTSTRAP_SESSION_NOT_AUTHORIZED');
    }
    const tokenHash=createHash('sha256').update(input.sessionToken,'utf8').digest('hex');
    const row=await this.secrets.load(input.operationId,input.userId,tokenHash);
    const suffix=row.identityId?.replace(/-/g,'');
    const matchingScope=row.topicScope===row.manufacturerDeviceId ||
      row.topicScope.endsWith(`/devices/${row.manufacturerDeviceId}`);
    const until=new Date(row.expiresAt).getTime();
    if (row.operationId!==input.operationId || !UUID.test(row.identityId) ||
        row.manufacturerDeviceId!==before.identity.manufacturerDeviceId ||
        row.username!==`shd_${suffix}` ||
        !NAME.test(row.clientId) || !NAME.test(row.username) ||
        row.clientId!==`shd-${suffix}` || !SCOPE.test(row.topicScope) ||
        !matchingScope || row.formatVersion!==1 || row.keyId!==this.keyId ||
        !Number.isFinite(until) || until<=Date.now()) {
      throw new Error('MQTT_BOOTSTRAP_BINDING_INVALID');
    }
    const after=await this.sessions.get(input.userId,input.homeId,input.sessionId,input.sessionToken);
    if (after.sessionId!==input.sessionId || after.identity?.manufacturerDeviceId!==row.manufacturerDeviceId ||
        !['DEVICE_IDENTIFIED','WAITING_FOR_MQTT'].includes(after.status) ||
        !isLiveExpiry(after.expiresAt)) {
      throw new Error('MQTT_BOOTSTRAP_SESSION_CHANGED');
    }
    const cfg=this.runtime.config;
    if (!cfg.brokerUrl || !cfg.tls || !cfg.caFile) {
      throw new Error('MQTT_BOOTSTRAP_MQTTS_REQUIRED');
    }
    const url=new URL(cfg.brokerUrl);
    if (url.protocol!=='mqtts:' || !url.hostname || (cfg.caFile!==this.caFile)) {
      throw new Error('MQTT_BOOTSTRAP_BROKER_CONFIG_INVALID');
    }
    const ca=readFileSync(this.caFile,'utf8');
    const certs=ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!certs?.length || certs.length!==1 || ca.length>16384 ||
        ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,'').trim()) {
      throw new Error('MQTT_BOOTSTRAP_CA_INVALID');
    }
    certs.forEach(c=>new X509Certificate(c));
    // SQL031 retorna un sobre AES-GCM con AAD ligado a operacion+key_id.
    const nonce=Buffer.from(row.nonce,'base64url');
    const ciphertext=Buffer.from(row.ciphertext,'base64url');
    const tag=Buffer.from(row.authTag,'base64url');
    if (nonce.length!==12 || ciphertext.length!==43 || tag.length!==16 ||
        nonce.toString('base64url')!==row.nonce ||
        ciphertext.toString('base64url')!==row.ciphertext ||
        tag.toString('base64url')!==row.authTag) {
      throw new Error('MQTT_BOOTSTRAP_ENVELOPE_INVALID');
    }
    let password:string;
    try {
      const decryptor=createDecipheriv('aes-256-gcm',this.aesKey,nonce);
      decryptor.setAAD(Buffer.from(`smarthome:mqtt:preparation-password:v1:${this.keyId}:${row.operationId}`,'utf8'));
      decryptor.setAuthTag(tag);
      password=Buffer.concat([decryptor.update(ciphertext),decryptor.final()]).toString('utf8');
      if (!SECRET.test(password)) throw new Error();
    } catch { throw new Error('MQTT_BOOTSTRAP_DECRYPT_FAILED'); }
    // Nunca guardar o registrar esta respuesta; TTL de transporte 2min max.
    return {
      phase:'PROVISIONING_AUTHORIZED' as const,
      manufacturerDeviceId:row.manufacturerDeviceId,
      expiresAt:new Date(Math.min(until,Date.now()+120000)).toISOString(),
      broker:{hostname:url.hostname,port:Number(url.port||8883),caPem:ca},
      identity:{username:row.username,password,clientId:row.clientId,topicPrefix:row.topicScope},
    };
  }
}
