import { parseFlespiShellyTelemetry } from './flespi-shelly-telemetry.parser';

const now = new Date('2026-10-30T19:00:00.000Z');
const parseSwitch = (data: Record<string, unknown>) =>
  parseFlespiShellyTelemetry('shelly-switch', data, 0, now);
const parseEvent = (method: string, value: unknown) =>
  parseFlespiShellyTelemetry('shelly-events', {
    method,
    params: { 'switch:0': value },
  }, 0, now);

describe('flespi: validación estricta de telemetría Shelly', () => {
  it('interpreta Switch.GetStatus / status/switch:0 con lectura real OFF', () => {
    expect(parseSwitch({
      id: 0, output: false, apower: 0, voltage: 117.8, current: 0,
      freq: 59.9, aenergy: { total: 1 }, temperature: { tC: 37.1 },
    })).toEqual({
      connectivityStatus: 'ONLINE', isOn: false, currentPowerW: 0,
      voltageV: 117.8, currentA: 0, frequencyHz: 59.9,
      energyTotalKwh: 0.001, temperatureC: 37.1,
      readAt: now.toISOString(),
    });
  });

  it('interpreta NotifyStatus parcial sin inventar estado ON/OFF', () => {
    const result = parseEvent('NotifyStatus', { apower: 13.4 });
    expect(result).toMatchObject({ connectivityStatus: 'ONLINE', currentPowerW: 13.4 });
    expect(result?.isOn).toBeUndefined();
  });

  it('interpreta NotifyFullStatus con switch:0', () => {
    expect(parseEvent('NotifyFullStatus', {
      output: true, apower: 23.6, aenergy: { total: 1500 },
    })).toMatchObject({
      connectivityStatus: 'ONLINE', isOn: true,
      currentPowerW: 23.6, energyTotalKwh: 1.5,
    });
  });

  it('tolera temperatura negativa (pero no consumo eléctrico negativo)', () => {
    expect(parseSwitch({ temperature: { tC: -2.5 } })?.temperatureC).toBe(-2.5);
    expect(parseSwitch({ apower: -10 })).toBeNull();
  });

  it.each([
    ['output no booleano', { output: 'on', apower: 20 }],
    ['potencia no numérica', { apower: '20' }],
    ['voltaje negativo', { voltage: -1 }],
    ['corriente negativa', { current: -2 }],
    ['frecuencia infinita', { freq: Infinity }],
    ['aenergy inválido', { apower: 1, aenergy: 'bad' }],
    ['energía negativa', { aenergy: { total: -100 } }],
    ['energía no numérica', { aenergy: { total: '1' } }],
    ['temperatura inválida', { temperature: { tC: '37' } }],
  ])('rechaza %s', (_label, payload) => {
    expect(parseSwitch(payload as Record<string, unknown>)).toBeNull();
  });

  it('descarta notificaciones sin datos de switch', () => {
    expect(parseSwitch({ id: 0, source: 'init' })).toBeNull();
    expect(parseEvent('NotifyStatus', { source: 'init' })).toBeNull();
  });

  it('ignora métodos RPC no soportados y switch distinto de 0', () => {
    expect(parseEvent('NotifyEvent', { output: true })).toBeNull();
    expect(parseFlespiShellyTelemetry('shelly-events', {
      method: 'NotifyStatus', params: { 'switch:1': { output: true } },
    }, 0, now)).toBeNull();
  });

  it('no confía en timestamps enviados por el dispositivo', () => {
    const result = parseSwitch({ output: false, ts: '2020-01-01' });
    expect(result?.readAt).toBe(now.toISOString());
  });

  it('mantiene números nulos como ausencia y no los interpreta como cero', () => {
    const result = parseSwitch({ output: false, apower: null });
    expect(result?.currentPowerW).toBeNull();
    expect(result?.isOn).toBe(false);
  });
});
