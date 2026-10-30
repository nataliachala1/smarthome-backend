import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateHomeEnergyTariffDto } from './create-home-energy-tariff.dto';

async function errorsFor(body: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateHomeEnergyTariffDto, body);
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe('CreateHomeEnergyTariffDto', () => {
  it('acepta un precio decimal en texto y una fecha real', async () => {
    await expect(
      errorsFor({ unitPriceCopKwh: '950.2500', effectiveFrom: '2026-11-01' }),
    ).resolves.toEqual([]);
    await expect(
      errorsFor({ unitPriceCopKwh: '0.5', effectiveFrom: '2024-02-29' }),
    ).resolves.toEqual([]);
    await expect(
      errorsFor({
        unitPriceCopKwh: '9999999999.9999',
        effectiveFrom: '2026-01-31',
      }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['0'],
    ['0.0000'],
    ['-1'],
    ['1.12345'],
    ['12345678901'],
    ['1e3'],
    ['950,25'],
    ['NaN'],
    [''],
    [950.25],
    [null],
  ])('rechaza el precio %p', async (unitPriceCopKwh) => {
    await expect(
      errorsFor({ unitPriceCopKwh, effectiveFrom: '2026-11-01' }),
    ).resolves.toEqual(['unitPriceCopKwh']);
  });

  it.each([
    ['2026-02-30'],
    ['2026-13-01'],
    ['2026-11-01T00:00:00Z'],
    ['01/11/2026'],
    [undefined],
  ])('rechaza la fecha %p', async (effectiveFrom) => {
    await expect(
      errorsFor({ unitPriceCopKwh: '950.25', effectiveFrom }),
    ).resolves.toEqual(['effectiveFrom']);
  });
});
