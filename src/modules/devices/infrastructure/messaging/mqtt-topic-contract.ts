import {
  mqttDeviceId,
  MqttConfiguration,
} from '../../../../config/mqtt-config';

export type MqttStatusKind = 'internal' | 'shelly-switch' | 'shelly-events';
export interface MqttStatusTopic {
  manufacturerDeviceId: string;
  kind: MqttStatusKind;
}

export class MqttTopicContract {
  constructor(private readonly config: MqttConfiguration) {}

  private assertDeviceId(id: string): void {
    if (!mqttDeviceId.test(id)) {
      throw new Error('MQTT_DEVICE_ID_INVALID');
    }
  }

  shellyPrefix(id: string): string {
    this.assertDeviceId(id);
    return this.config.namespace ? `${this.config.devicePrefix}/${id}` : id;
  }

  control(id: string): string {
    this.assertDeviceId(id);
    return id.toLowerCase().startsWith('shelly')
      ? `${this.shellyPrefix(id)}/rpc`
      : `${this.config.devicePrefix}/${id}/control`;
  }

  subscriptions(): string[] {
    // Single-device flespi ACL: no wildcard subscriptions or internal topic.
    if (this.config.flespiDeviceId) {
      const prefix = this.shellyPrefix(this.config.flespiDeviceId);
      return [
        `${prefix}/status/switch:${this.config.switchId}`,
        `${prefix}/events/rpc`,
      ];
    }
    const shelly = this.config.namespace
      ? `${this.config.devicePrefix}/+`
      : '+';
    return [
      `${this.config.devicePrefix}/+/status`,
      `${shelly}/status/switch:${this.config.switchId}`,
      `${shelly}/events/rpc`,
    ];
  }

  parseStatus(topic: string): MqttStatusTopic | null {
    if (this.config.flespiDeviceId) {
      const id = this.config.flespiDeviceId;
      const prefix = this.shellyPrefix(id);
      if (topic === `${prefix}/status/switch:${this.config.switchId}`) {
        return { manufacturerDeviceId: id, kind: 'shelly-switch' };
      }
      if (topic === `${prefix}/events/rpc`) {
        return { manufacturerDeviceId: id, kind: 'shelly-events' };
      }
      return null;
    }
    const parts = topic.split('/');
    for (const [index, filter] of this.subscriptions().entries()) {
      const expected = filter.split('/');
      if (parts.length !== expected.length) continue;
      const idIndex = expected.indexOf('+');
      if (!expected.every((part, i) => part === '+' || part === parts[i]))
        continue;
      const id = parts[idIndex];
      if (!mqttDeviceId.test(id)) return null;
      const kind = (['internal', 'shelly-switch', 'shelly-events'] as const)[
        index
      ];
      if (kind !== 'internal' && !id.toLowerCase().startsWith('shelly'))
        return null;
      return { manufacturerDeviceId: id, kind };
    }
    return null;
  }
}
