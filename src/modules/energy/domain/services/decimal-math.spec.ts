import { percentage, roundDecimal } from './decimal-math';

describe('decimal-math (sin Number binario)', () => {
  it('redondea half-up sin errores de coma flotante', () => {
    expect(roundDecimal('7201.7500000000', 2)).toBe('7201.75');
    expect(roundDecimal('0.005', 2)).toBe('0.01');
    expect(roundDecimal('1.004', 2)).toBe('1.00');
    expect(roundDecimal('2.675', 2)).toBe('2.68');
    expect(roundDecimal('6.5', 6)).toBe('6.500000');
    expect(roundDecimal('0', 2)).toBe('0.00');
    expect(roundDecimal('-1.005', 2)).toBe('-1.01');
  });

  it('calcula porcentajes exactos y permite superar 100', () => {
    expect(percentage('7201.75', '10000.00')).toBe('72.02');
    expect(percentage('6.500000', '5.000000')).toBe('130.00');
    expect(percentage('1', '3')).toBe('33.33');
    expect(percentage('2', '3')).toBe('66.67');
    expect(percentage('0', '125')).toBe('0.00');
  });

  it('rechaza textos que no son decimales y la división por cero', () => {
    expect(() => roundDecimal('1e3', 2)).toThrow();
    expect(() => percentage('1', '0.00')).toThrow();
  });
});
