import { identifyFlespiShellyEvent } from './flespi-shelly-event-key';

const topic = 'smarthome/dev/v1/devices/shelly1pmg4-d885acf06990/events/rpc';
const payload = (value: unknown) => Buffer.from(JSON.stringify(value));
const frame = (ts: unknown, data: unknown, method = 'NotifyStatus') => ({
  src: 'shelly1pmg4-d885acf06990', dst: 'shelly1pmg4-d885acf06990/events',
  method, params: { ts, 'switch:0': data },
});

describe('SQL035: identidad de evento Shelly (sin claves por recepción)', () => {
  it('produce una clave SHA-256 estable de 64 hex para el mismo evento', () => {
    const value = payload(frame(1793388600.25, {
      output: true, apower: 12.5, aenergy: { total: 500, by_minute: [1, 2] },
    }));
    const a = identifyFlespiShellyEvent(topic, value, 0);
    const b = identifyFlespiShellyEvent(topic, value, 0);
    expect(a).toEqual(b);
    expect(a?.eventKey).toMatch(/^[0-9a-f]{64}$/);
    expect(a?.deviceEventTs).toBe(1793388600.25);
  });

  it('ignora el orden de las claves JSON y los cambios de envoltura', () => {
    const a = frame(1793388600.25, { output: false, aenergy: { total: 23, by_minute: [1, 2] } });
    const b = { method: 'NotifyStatus', params: {
      'switch:0': { aenergy: { by_minute: [1, 2], total: 23 }, output: false },
      ts: 1793388600.25,
    }, dst: 'other-receiver', src: 'shelly1pmg4-d885acf06990' };
    expect(identifyFlespiShellyEvent(topic, payload(a), 0)).toEqual(
      identifyFlespiShellyEvent(topic, payload(b), 0),
    );
  });

  it('distingue timestamps, valores, método y tópico', () => {
    const first = identifyFlespiShellyEvent(topic, payload(frame(1793388600.25, { apower: 1 })), 0);
    const variants = [
      identifyFlespiShellyEvent(topic, payload(frame(1793388601, { apower: 1 })), 0),
      identifyFlespiShellyEvent(topic, payload(frame(1793388600.25, { apower: 2 })), 0),
      identifyFlespiShellyEvent(topic, payload(frame(1793388600.25, { apower: 1 }, 'NotifyFullStatus')), 0),
      identifyFlespiShellyEvent(topic.replace('dev/v1','dev/v2'),
        payload(frame(1793388600.25, { apower: 1 })), 0),
    ];
    for (const value of variants) expect(value?.eventKey).not.toBe(first?.eventKey);
  });

  it.each([
    ['direct status', topic.replace('/events/rpc', '/status/switch:0'), frame(1793388600.25, { apower: 1 })],
    ['sin ts', topic, frame(undefined, { apower: 1 })],
    ['ts nulo', topic, frame(null, { apower: 1 })],
    ['ts string', topic, frame('1793388600.25', { apower: 1 })],
    ['ts cero', topic, frame(0, { apower: 1 })],
    ['ts negativo', topic, frame(-1, { apower: 1 })],
    ['ts infinito', topic, frame(Infinity, { apower: 1 })],
    ['sin componente', topic, frame(1793388600.25, undefined)],
    ['componente vacío', topic, frame(1793388600.25, {})],
    ['método ajeno', topic, frame(1793388600.25, { apower: 1 }, 'NotifyEvent')],
  ])('no crea una identidad falsa: %s', (_name, t, value) => {
    expect(identifyFlespiShellyEvent(t, payload(value), 0)).toBeNull();
  });

  it('rechaza JSON inválido', () => {
    expect(identifyFlespiShellyEvent(topic, Buffer.from('{bad'), 0)).toBeNull();
  });
});
