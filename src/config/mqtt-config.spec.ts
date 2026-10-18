import { parseMqttConfig } from './mqtt-config';
import { MqttTopicContract } from '../modules/devices/infrastructure/messaging/mqtt-topic-contract';

const production = {
  NODE_ENV: 'production',
  MQTT_BROKER_URL: 'mqtts://broker.example.test:8883',
  MQTT_USERNAME: 'synthetic-service',
  MQTT_PASSWORD: 'synthetic-password',
  MQTT_TOPIC_NAMESPACE: 'smarthome/staging/v1',
};

describe('MQTT configuration and topic boundaries', () => {
  it('allows disabled MQTT and legacy local TCP only outside production', () => {
    expect(parseMqttConfig({}).brokerUrl).toBeUndefined();
    expect(
      parseMqttConfig({ MQTT_BROKER_URL: 'mqtt://localhost:1883' }).tls,
    ).toBe(false);
    expect(parseMqttConfig(production).tls).toBe(true);
  });

  it.each([
    'mqtt://broker.example.test',
    'ws://broker.example.test',
    'wss://broker.example.test',
    '',
    undefined,
  ])('requires MQTT TLS in production (%s)', (MQTT_BROKER_URL) => {
    expect(() => parseMqttConfig({ ...production, MQTT_BROKER_URL })).toThrow(
      'MQTT_BROKER_URL',
    );
  });

  it.each([
    'mqtts://user:synthetic-secret@broker.example.test',
    'mqtts://broker.example.test?clientId=other',
    'mqtts://broker.example.test#fragment',
    'mqtts://broker.example.test/private',
    'mqtts://broker.example.test:0',
    'mqtts://broker.example.test:65536',
    'mqtts://broker.example.test:abc',
    ' mqtts://broker.example.test',
    'mqtts://broker.example.test?',
    'not-a-url-synthetic-secret',
    'mqtts://broker.example.test\n',
    'mqtts://broker%2eexample.test',
    'mqtts://broker.example.test\\unexpected',
  ])('rejects unsafe broker URL without echoing it', (MQTT_BROKER_URL) => {
    try {
      parseMqttConfig({ ...production, MQTT_BROKER_URL });
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('MQTT_BROKER_URL');
      expect((error as Error).message).not.toContain(MQTT_BROKER_URL);
    }
  });

  it.each([
    { MQTT_USERNAME: undefined },
    { MQTT_PASSWORD: undefined },
    { MQTT_USERNAME: undefined, MQTT_PASSWORD: undefined },
    { MQTT_PASSWORD: ' ' },
    { MQTT_PASSWORD: true },
  ])('requires a complete service credential in production', (settings) => {
    expect(() => parseMqttConfig({ ...production, ...settings })).toThrow(
      'MQTT_',
    );
  });

  it.each([
    { MQTT_TLS_REJECT_UNAUTHORIZED: 'false' },
    { MQTT_TLS_REJECT_UNAUTHORIZED: '0' },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  ])('rejects disabled certificate verification', (settings) => {
    expect(() => parseMqttConfig({ ...production, ...settings })).toThrow(
      'TLS',
    );
  });

  it('rejects a CA configuration with a plaintext connection', () => {
    expect(() =>
      parseMqttConfig({
        MQTT_BROKER_URL: 'mqtt://localhost',
        MQTT_TLS_CA_FILE: 'ca.pem',
      }),
    ).toThrow('mqtts://');
  });

  it.each([
    '',
    undefined,
    '/smarthome',
    'smarthome/',
    'a//b',
    'a/+',
    '#',
    '$SYS',
    'a\u0000b',
    'a b',
    'a\n',
    'a'.repeat(129),
  ])(
    'rejects missing or invalid production namespace (%s)',
    (MQTT_TOPIC_NAMESPACE) => {
      expect(() =>
        parseMqttConfig({ ...production, MQTT_TOPIC_NAMESPACE }),
      ).toThrow('MQTT_TOPIC_NAMESPACE');
    },
  );

  it.each([
    ['MQTT_STATUS_TOPIC_FILTER', '#'],
    ['MQTT_CONTROL_TOPIC_PREFIX', 'smarthome/devices'],
    ['MQTT_SHELLY_SWITCH_TOPIC_FILTER', '+/status/switch:0'],
    ['MQTT_SHELLY_RPC_EVENTS_TOPIC_FILTER', '+/events/rpc'],
    ['MQTT_SHELLY_RPC_SOURCE', 'other/backend'],
    ['MQTT_SHELLY_SWITCH_ID', 'NaN'],
    ['MQTT_SHELLY_SWITCH_ID', '-1'],
    ['MQTT_SHELLY_SWITCH_ID', '9007199254740992'],
    ['MQTT_CLIENT_ID', 'client/invalid'],
    ['MQTT_CLIENT_ID', 'client\n'],
    ['MQTT_SHELLY_SWITCH_ID', '0\n'],
  ])('rejects incompatible %s', (key, value) => {
    expect(() => parseMqttConfig({ ...production, [key]: value })).toThrow(key);
  });

  it('prevents control and subscriber clients from evicting one another', () => {
    expect(() =>
      parseMqttConfig({
        ...production,
        MQTT_CLIENT_ID: 'same',
        MQTT_STATUS_CLIENT_ID: 'same',
      }),
    ).toThrow('distintos');
  });

  it('preserves the default legacy local routes', () => {
    const topics = new MqttTopicContract(parseMqttConfig({}));
    expect(topics.control('Lamp-1')).toBe('smarthome/devices/Lamp-1/control');
    expect(topics.control('shelly-test')).toBe('shelly-test/rpc');
    expect(topics.subscriptions()).toEqual([
      'smarthome/devices/+/status',
      '+/status/switch:0',
      '+/events/rpc',
    ]);
    expect(topics.parseStatus('shelly-test/status/switch:0')).toEqual({
      manufacturerDeviceId: 'shelly-test',
      kind: 'shelly-switch',
    });
  });

  it('uses the configured legacy prefix for both outbound and incoming messages', () => {
    const topics = new MqttTopicContract(
      parseMqttConfig({ MQTT_CONTROL_TOPIC_PREFIX: 'custom/test/devices' }),
    );
    expect(topics.control('Lamp-1')).toBe('custom/test/devices/Lamp-1/control');
    expect(
      topics.parseStatus('custom/test/devices/Lamp-1/status')
        ?.manufacturerDeviceId,
    ).toBe('Lamp-1');
    expect(topics.parseStatus('smarthome/devices/Lamp-1/status')).toBeNull();
  });

  it('generates and parses nested namespace routes without changing the device identity', () => {
    const topics = new MqttTopicContract(parseMqttConfig(production));
    const prefix = 'smarthome/staging/v1/devices';
    expect(topics.control('shelly-test')).toBe(`${prefix}/shelly-test/rpc`);
    expect(topics.control('Lamp-1')).toBe(`${prefix}/Lamp-1/control`);
    expect(topics.shellyPrefix('shelly-test')).toBe(`${prefix}/shelly-test`);
    expect(topics.parseStatus(`${prefix}/shelly-test/events/rpc`)).toEqual({
      manufacturerDeviceId: 'shelly-test',
      kind: 'shelly-events',
    });
    expect(
      topics.parseStatus(`${prefix}/shelly-test/status/switch:0`)?.kind,
    ).toBe('shelly-switch');
    expect(topics.parseStatus(`${prefix}/Lamp-1/status`)?.kind).toBe(
      'internal',
    );
  });

  it('keeps the switch component consistent in subscriptions and parsing', () => {
    const topics = new MqttTopicContract(
      parseMqttConfig({ ...production, MQTT_SHELLY_SWITCH_ID: '2' }),
    );
    expect(
      topics.parseStatus(
        'smarthome/staging/v1/devices/shelly-test/status/switch:2',
      )?.kind,
    ).toBe('shelly-switch');
    expect(
      topics.parseStatus(
        'smarthome/staging/v1/devices/shelly-test/status/switch:0',
      ),
    ).toBeNull();
  });

  it.each([
    'smarthome/production/v1/devices/shelly-test/status/switch:0',
    'shelly-test/status/switch:0',
    'smarthome/devices/Lamp-1/status',
    'smarthome/staging/v1/devices/shelly-test/events/rpc/extra',
    'smarthome/staging/v1/devices//status',
    'smarthome/staging/v1/devices/+/status',
    'smarthome/staging/v1/devices/ bad /status',
    'smarthome/staging/v1/devices/other/status/switch:0',
  ])('rejects topics outside the exact contract: %s', (topic) => {
    expect(
      new MqttTopicContract(parseMqttConfig(production)).parseStatus(topic),
    ).toBeNull();
  });

  it.each([
    '',
    '+',
    '#',
    'shelly/other',
    'shelly\u0000test',
    'shelly-test\n',
    ' shelly-test',
    'x'.repeat(101),
  ])('rejects device identifiers that can alter a topic (%s)', (id) => {
    const topics = new MqttTopicContract(parseMqttConfig(production));
    expect(() => topics.control(id)).toThrow('MQTT_DEVICE_ID_INVALID');
    expect(() => topics.shellyPrefix(id)).toThrow('MQTT_DEVICE_ID_INVALID');
  });
});
