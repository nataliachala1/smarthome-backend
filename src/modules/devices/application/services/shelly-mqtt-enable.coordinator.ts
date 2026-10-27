import type { ShellyPairingSessionService } from './shelly-pairing-session.service';
import type { MqttDeviceIdentityProvider } from '../../domain/services/mqtt-device-identity-provider';
import { buildShellyMqttAclPlan } from './shelly-mqtt-acl.policy';
import type { MqttRuntimeService } from '../../infrastructure/messaging/mqtt-runtime.service';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export interface MqttEnableClaim {
  operationId:string; leaseToken:string; identityId:string;
  username:string; clientId:string; roleName:string; leaseUntil:Date;
}
export interface MqttEnablePort {
  request(operationId:string,actorId:string,sessionToken:string):Promise<void>;
  claim(operationId:string):Promise<MqttEnableClaim>;
  confirm(claim:MqttEnableClaim):Promise<void>;
  uncertain(claim:MqttEnableClaim):Promise<void>;
}
export interface MqttEnableRequest {
  userId:string; homeId:string; sessionId:string; sessionToken:string;
  operationId:string;
  /** Confirmación obtenida de readback MQTT.GetConfig en el mismo Shelly físico. */
  localConfigurationReadbackVerified?:boolean;
  /** Confirmación humana para una red LAN aislada de desarrollo. */
  explicitlyTrustedLocalNetwork?:boolean;
}

export type MqttEnableProfile = 'local-dev' | 'vps-dev-tls';
/**
 * Local exige readback y aprobación de laboratorio; VPS usa autorización
 * OWNER+token y lease SQL030. En ambos perfiles solo alcanza AWAITING_AUTH.
 */
export class ShellyMqttEnableCoordinator {
  constructor(
    private readonly sessions:Pick<ShellyPairingSessionService,'get'|'assertCanManageHome'>,
    private readonly port:MqttEnablePort,
    private readonly broker:Pick<MqttDeviceIdentityProvider,
      'verifyPreparedDisabled'|'enableIdentity'|'inspectIdentity'|'disableIdentity'>,
    private readonly runtime:Pick<MqttRuntimeService,'topics'|'config'>,
    private readonly profile:MqttEnableProfile='local-dev',
  ) {}

  async enable(input:MqttEnableRequest):Promise<{phase:'AWAITING_MQTT_AUTH';mqttAuthenticated:false}> {
    if (!UUID.test(input.operationId) || !UUID.test(input.sessionId) ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(input.sessionToken) ||
        (this.profile==='local-dev' &&
          (!input.localConfigurationReadbackVerified || !input.explicitlyTrustedLocalNetwork))) {
      throw new Error('MQTT_ENABLE_REQUEST_INVALID');
    }
    await this.sessions.assertCanManageHome(input.userId,input.homeId);
    const current=await this.sessions.get(input.userId,input.homeId,input.sessionId,input.sessionToken);
    if (current.sessionId !== input.sessionId || current.homeId !== input.homeId ||
        !['DEVICE_IDENTIFIED','WAITING_FOR_MQTT'].includes(current.status) ||
        !current.expiresAt || new Date(current.expiresAt).getTime()<=Date.now() ||
        current.identity?.modelCode!=='S4SW-001P16EU' || current.identity.generation!==4 ||
        current.identity.verification!=='MOBILE_REPORTED_UNVERIFIED' ||
        !current.identity.manufacturerDeviceId) {
      throw new Error('MQTT_ENABLE_SESSION_NOT_AUTHORIZED');
    }
    const manufacturerId=current.identity.manufacturerDeviceId;
    const plan=buildShellyMqttAclPlan(this.runtime.topics,manufacturerId,
      this.runtime.config.switchId);
    // SQL030 confirma OWNER, token, vigencia, operacion PREPARED_DISABLED y secreto.
    // SQL030 reclama lease único; no repetir automáticamente una respuesta incierta.
    await this.port.request(input.operationId,input.userId,input.sessionToken);
    const claim=await this.port.claim(input.operationId);
    const suffix=claim.identityId.replace(/-/g,'');
    const expectedUser=`shd_${suffix}`, expectedClient=`shd-${suffix}`;
    if (claim.operationId!==input.operationId || claim.username!==expectedUser || claim.clientId!==expectedClient ||
        claim.roleName!==`role_shd_${suffix}`) {
      await this.port.uncertain(claim).catch(()=>undefined);
      throw new Error('MQTT_ENABLE_BINDING_MISMATCH_REQUIRES_RECONCILIATION');
    }
    try {
      await this.broker.verifyPreparedDisabled({username:claim.username,
        clientId:claim.clientId,roleName:claim.roleName,
        topicScope:plan.topicScope,acls:plan.acls});
      if (Date.now()>=claim.leaseUntil.getTime()) throw new Error('LEASE_EXPIRED');
      await this.broker.enableIdentity(claim.username);
      const snapshot=await this.broker.inspectIdentity(claim.username);
      if (!snapshot || snapshot.disabled || snapshot.clientId!==claim.clientId ||
          snapshot.roleNames.length!==1 || snapshot.roleNames[0]!==claim.roleName ||
          Date.now()>=claim.leaseUntil.getTime()) {
        throw new Error('BROKER_ENABLE_OUTCOME_UNCERTAIN');
      }
      await this.sessions.assertCanManageHome(input.userId,input.homeId);
      const again=await this.sessions.get(input.userId,input.homeId,input.sessionId,input.sessionToken);
      if (again.sessionId!==input.sessionId ||
          !['DEVICE_IDENTIFIED','WAITING_FOR_MQTT'].includes(again.status) ||
          again.identity?.manufacturerDeviceId!==manufacturerId ||
          again.identity?.modelCode!=='S4SW-001P16EU' || again.identity.generation!==4 ||
          !again.expiresAt || new Date(again.expiresAt).getTime()<=Date.now()) {
        throw new Error('SESSION_CHANGED_DURING_BROKER_ENABLE');
      }
      await this.port.confirm(claim);
      return {phase:'AWAITING_MQTT_AUTH',mqttAuthenticated:false};
    } catch {
      // Resultado de Mosquitto o del COMMIT SQL incierto: bloquear reintentos.
      // The validated binding is safe to disable even if inspection failed
      // before enable; fail closed on a possibly active broker account.
      await this.broker.disableIdentity(claim.username).catch(()=>undefined);
      await this.port.uncertain(claim).catch(()=>undefined);
      throw new Error('MQTT_ENABLE_OUTCOME_REQUIRES_RECONCILIATION');
    }
  }
}
