/**
 * Aritmética decimal exacta sobre texto (sin Number binario) para importes y kWh.
 * Usa BigInt escalado; redondeo "half-up" (0.5 se aleja de cero).
 */

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

interface Scaled {
  value: bigint;
  scale: number;
}

function parse(value: string): Scaled {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error('Decimal inválido: ' + value);
  }

  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  const digits = BigInt(integerPart + fractionPart);

  return { value: negative ? -digits : digits, scale: fractionPart.length };
}

function pow10(exponent: number): bigint {
  return BigInt(10) ** BigInt(exponent);
}

function format(value: bigint, digits: number): string {
  const negative = value < BigInt(0);
  const absolute = (negative ? -value : value)
    .toString()
    .padStart(digits + 1, '0');
  const integerPart = absolute.slice(0, absolute.length - digits);
  const fractionPart = absolute.slice(absolute.length - digits);
  const text = digits > 0 ? integerPart + '.' + fractionPart : integerPart;

  return negative && /[1-9]/.test(text) ? '-' + text : text;
}

/** División entera con redondeo half-up. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < BigInt(0) !== denominator < BigInt(0);
  const n = numerator < BigInt(0) ? -numerator : numerator;
  const d = denominator < BigInt(0) ? -denominator : denominator;
  const quotient = (n * BigInt(2) + d) / (d * BigInt(2));

  return negative ? -quotient : quotient;
}

/** Redondea un decimal a `digits` decimales. */
export function roundDecimal(value: string, digits: number): string {
  const parsed = parse(value);

  if (parsed.scale <= digits) {
    return format(parsed.value * pow10(digits - parsed.scale), digits);
  }

  return format(
    divideHalfUp(parsed.value, pow10(parsed.scale - digits)),
    digits,
  );
}

/** (numerator / denominator) * 100, redondeado a `digits` decimales. */
export function percentage(
  numerator: string,
  denominator: string,
  digits = 2,
): string {
  const n = parse(numerator);
  const d = parse(denominator);

  if (d.value === BigInt(0)) {
    throw new Error('División por cero');
  }

  // n/d * 100 * 10^digits, llevando ambos a la misma escala.
  const scaledNumerator =
    n.value * pow10(d.scale) * BigInt(100) * pow10(digits);
  const scaledDenominator = d.value * pow10(n.scale);

  return format(divideHalfUp(scaledNumerator, scaledDenominator), digits);
}
