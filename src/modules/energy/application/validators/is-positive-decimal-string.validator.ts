import { ValidationOptions, registerDecorator } from 'class-validator';

/**
 * Validates a positive decimal sent as text that fits in NUMERIC(precision, scale).
 * Rejects JSON numbers, scientific notation, commas, signs, NaN and extra decimals.
 */
export function isPositiveDecimalString(
  value: unknown,
  precision: number,
  scale: number,
): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const integerDigits = precision - scale;
  const pattern = new RegExp(
    '^(0|[1-9]\\d{0,' +
      String(integerDigits - 1) +
      '})(\\.\\d{1,' +
      String(scale) +
      '})?$',
  );

  return pattern.test(value) && /[1-9]/.test(value);
}

export function IsPositiveDecimalString(
  precision: number,
  scale: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isPositiveDecimalString',
      target: object.constructor,
      propertyName: propertyName.toString(),
      constraints: [precision, scale],
      options: {
        message:
          '$property debe ser un decimal positivo en texto con máximo ' +
          String(precision - scale) +
          ' enteros y ' +
          String(scale) +
          ' decimales',
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) =>
          isPositiveDecimalString(value, precision, scale),
      },
    });
  };
}
