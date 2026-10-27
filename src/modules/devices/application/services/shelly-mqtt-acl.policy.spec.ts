import { parseMqttConfig } from '../../../../config/mqtt-config';
import { MqttTopicContract } from '../../infrastructure/messaging/mqtt-topic-contract';
import {
  assertShellyMqttReservationScope,
  buildShellyMqttAclPlan,
} from './shelly-mqtt-acl.policy';

const DEVICE_ID = 'shelly1pmg4-d885acf06990';

function topics(namespace?: string): MqttTopicContract {
  const config = parseMqttConfig({
    NODE_ENV: 'test',
    ...(namespace ? { MQTT_TOPIC_NAMESPACE: namespace } : {}),
  });
  return new MqttTopicContract(config);
}

describe('Shelly MQTT ACL policy', () => {
  it('derives the exact five Shelly topic permissions in local mode', () => {
    const plan = buildShellyMqttAclPlan(topics(), DEVICE_ID.toUpperCase(), 0);
    expect(plan.manufacturerDeviceId).toBe(DEVICE_ID);
    expect(plan.topicScope).toBe(DEVICE_ID);
    expect(plan.acls).toEqual([
      { type: 'publishClientSend', topic: `${DEVICE_ID}/status/switch:0`, priority: 10 },
      { type: 'publishClientSend', topic: `${DEVICE_ID}/events/rpc`, priority: 10 },
      { type: 'subscribeLiteral', topic: `${DEVICE_ID}/rpc`, priority: 10 },
      { type: 'publishClientReceive', topic: `${DEVICE_ID}/rpc`, priority: 10 },
      { type: 'unsubscribeLiteral', topic: `${DEVICE_ID}/rpc`, priority: 10 },
    ]);
  });

  it('derives the namespaced scope from the backend topic contract', () => {
    const ns = 'smarthome/development/v1';
    const plan = buildShellyMqttAclPlan(topics(ns), DEVICE_ID, 0);
    expect(plan.topicScope).toBe(`${ns}/devices/${DEVICE_ID}`);
    expect(plan.acls.map((acl) => acl.topic)).toEqual([
      `${plan.topicScope}/status/switch:0`,
      `${plan.topicScope}/events/rpc`,
      `${plan.topicScope}/rpc`,
      `${plan.topicScope}/rpc`,
      `${plan.topicScope}/rpc`,
    ]);
    expect(plan.acls.every((acl) => !acl.topic.includes('#') && !acl.topic.includes('+')))
      .toBe(true);
  });

  it.each([
    'other-device',
    `${DEVICE_ID}/other`,
    `${DEVICE_ID}#`,
    `${DEVICE_ID}.`,
    '',
  ])('refuses an unsafe physical ID: %s', (input) => {
    expect(() => buildShellyMqttAclPlan(topics(), input, 0))
      .toThrow('SHELLY_MQTT_MANUFACTURER_ID_INVALID');
  });

  it.each([-1, 1.5, 1000])('refuses an unsupported switch number: %s', (switchId) => {
    expect(() => buildShellyMqttAclPlan(topics(), DEVICE_ID, switchId))
      .toThrow('SHELLY_MQTT_SWITCH_ID_UNSUPPORTED');
  });

  it('accepts a reservation only for the exact device and topic scope', () => {
    const plan = buildShellyMqttAclPlan(topics('smarthome/dev/v1'), DEVICE_ID, 0);
    expect(() => assertShellyMqttReservationScope(
      plan, DEVICE_ID, plan.topicScope,
    )).not.toThrow();
    expect(() => assertShellyMqttReservationScope(
      plan, 'shelly1pmg4-other', plan.topicScope,
    )).toThrow('SHELLY_MQTT_RESERVATION_SCOPE_MISMATCH');
    expect(() => assertShellyMqttReservationScope(
      plan, DEVICE_ID, `${plan.topicScope}/other`,
    )).toThrow('SHELLY_MQTT_RESERVATION_SCOPE_MISMATCH');
  });
});
