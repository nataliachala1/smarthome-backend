import type { MqttIdentityAcl } from '../../domain/services/mqtt-device-identity-provider';
import { MqttTopicContract } from '../../infrastructure/messaging/mqtt-topic-contract';

/**
 * MQTT plan built exclusively from the data normalized and reserved
 * by the backend. It is not a user authorization or a physical proof.
 *
 * Before calling the broker, the orchestrator must compare topicScope with the
 * value reserved in devices.mqtt_pairing_operation and verify the OWNER session.
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

  // shellyPrefix is the MQTT contract shared with control and telemetry.
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
 * Prevents a reservation of one Shelly from being assigned to another's topics.
 * The reservation comes from the privileged SQL function, not from the phone.
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
