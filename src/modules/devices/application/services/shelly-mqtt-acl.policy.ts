import type { MqttIdentityAcl } from '../../domain/services/mqtt-device-identity-provider';
import { MqttTopicContract } from '../../infrastructure/messaging/mqtt-topic-contract';

/**
 * Plan MQTT construido exclusivamente con los datos normalizados y reservados
 * por el backend. No representa autorización de un usuario ni prueba física.
 *
 * Antes de llamar al broker, el orquestador debe comparar topicScope con el
 * valor reservado en devices.mqtt_pairing_operation y verificar la sesión OWNER.
 */
export interface ShellyMqttAclPlan {
  readonly manufacturerDeviceId: string;
  readonly topicScope: string;
  readonly acls: readonly MqttIdentityAcl[];
}

export function buildShellyMqttAclPlan(
  topics: MqttTopicContract,
  rawManufacturerDeviceId: string,
  switchId: number,
): ShellyMqttAclPlan {
  if (typeof rawManufacturerDeviceId !== 'string') {
    throw new Error('SHELLY_MQTT_MANUFACTURER_ID_INVALID');
  }
  const manufacturerDeviceId = rawManufacturerDeviceId.trim().toLowerCase();
  if (
    manufacturerDeviceId.length > 100 ||
    !/^shelly[a-z0-9_-]*$/.test(manufacturerDeviceId)
  ) {
    throw new Error('SHELLY_MQTT_MANUFACTURER_ID_INVALID');
  }
  if (!Number.isInteger(switchId) || switchId < 0 || switchId > 999) {
    throw new Error('SHELLY_MQTT_SWITCH_ID_UNSUPPORTED');
  }

  // shellyPrefix es el contrato MQTT compartido con control y telemetría.
  const topicScope = topics.shellyPrefix(manufacturerDeviceId);
  const rpcTopic = topics.control(manufacturerDeviceId);
  if (rpcTopic !== `${topicScope}/rpc`) {
    throw new Error('SHELLY_MQTT_TOPIC_CONTRACT_MISMATCH');
  }

  const priority = 10;
  const acls: readonly MqttIdentityAcl[] = [
    {
      type: 'publishClientSend',
      topic: `${topicScope}/status/switch:${switchId}`,
      priority,
    },
    {
      type: 'publishClientSend',
      topic: `${topicScope}/events/rpc`,
      priority,
    },
    {
      type: 'subscribeLiteral',
      topic: rpcTopic,
      priority,
    },
    {
      type: 'publishClientReceive',
      topic: rpcTopic,
      priority,
    },
    {
      type: 'unsubscribeLiteral',
      topic: rpcTopic,
      priority,
    },
  ];
  return { manufacturerDeviceId, topicScope, acls };
}

/**
 * Evita que una reserva de un Shelly termine asignada a los tópicos de otro.
 * La reserva proviene de la función SQL privilegiada, no del teléfono.
 */
export function assertShellyMqttReservationScope(
  plan: ShellyMqttAclPlan,
  reservedManufacturerDeviceId: string,
  reservedTopicScope: string,
): void {
  if (
    reservedManufacturerDeviceId !== plan.manufacturerDeviceId ||
    reservedTopicScope !== plan.topicScope
  ) {
    throw new Error('SHELLY_MQTT_RESERVATION_SCOPE_MISMATCH');
  }
}
