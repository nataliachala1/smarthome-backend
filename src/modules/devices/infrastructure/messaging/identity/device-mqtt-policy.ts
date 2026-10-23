import {
  parseMqttConfig,
  MqttConfiguration,
} from '../../../../../config/mqtt-config';
import { MqttTopicContract } from '../mqtt-topic-contract';

export interface BrokerAcl {
  acltype: 'publishClientSend' | 'publishClientReceive' | 'subscribeLiteral';
  topic: string;
  allow: true;
  priority: number;
}

export interface DeviceMqttIdentity {
  identityId: string;
  username: string;
  clientId: string;
  roleName: string;
  topicPrefix: string;
  acls: BrokerAcl[];
}

export function deviceMqttUsername(identityId: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/.test(
      identityId,
    )
  ) {
    throw new Error('MQTT_IDENTITY_ID_INVALID');
  }
  return `device-${identityId}`;
}

function permissions(publish: string[], receive: string[]): BrokerAcl[] {
  return [
    ...publish.map((topic): BrokerAcl => ({
      acltype: 'publishClientSend',
      topic,
      allow: true,
      priority: 0,
    })),
    ...receive.flatMap((topic): BrokerAcl[] => [
      { acltype: 'publishClientReceive', topic, allow: true, priority: 0 },
      { acltype: 'subscribeLiteral', topic, allow: true, priority: 0 },
    ]),
  ];
}

/** Broker ACLs are technical identity boundaries, not household user roles. */
export class DeviceMqttPolicy {
  private readonly config: MqttConfiguration;
  private readonly topics: MqttTopicContract;

  constructor(namespace: string, switchId = 0, rpcSource?: string) {
    this.config = parseMqttConfig({
      MQTT_TOPIC_NAMESPACE: namespace,
      MQTT_SHELLY_SWITCH_ID: String(switchId),
      MQTT_SHELLY_RPC_SOURCE: rpcSource,
    });
    if (!this.config.namespace)
      throw new Error('MQTT_IDENTITY_NAMESPACE_REQUIRED');
    this.topics = new MqttTopicContract(this.config);
  }

  device(identityId: string, manufacturerDeviceId: string): DeviceMqttIdentity {
    const username = deviceMqttUsername(identityId);
    const topicPrefix = this.topics.shellyPrefix(manufacturerDeviceId);
    const shelly = manufacturerDeviceId.toLowerCase().startsWith('shelly');
    const publish = shelly
      ? [
          `${topicPrefix}/status/switch:${this.config.switchId}`,
          `${topicPrefix}/events/rpc`,
          `${topicPrefix}/online`,
          `${this.topics.rpcSource(manufacturerDeviceId)}/rpc`,
        ]
      : [`${topicPrefix}/status`];
    return {
      identityId,
      username,
      clientId: manufacturerDeviceId,
      roleName: username,
      topicPrefix,
      acls: permissions(publish, [this.topics.control(manufacturerDeviceId)]),
    };
  }

  backend(): BrokerAcl[] {
    return permissions(
      [
        `${this.config.devicePrefix}/+/control`,
        `${this.config.devicePrefix}/+/rpc`,
      ],
      [
        ...this.topics.subscriptions(),
        `${this.config.rpcSource}/devices/+/rpc`,
      ],
    );
  }
}
