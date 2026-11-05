import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { UpsertHomeEnergyGoalDto } from './upsert-home-energy-goal.dto';

async function errorsFor(body: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpsertHomeEnergyGoalDto, body);
  const errors = await validate(dto);
  return errors.map((error) => error.property).sort();
}

describe('UpsertHomeEnergyGoalDto', () => {
  it.each([
    [{ monthlyBudgetCop: '120000.00', targetKwh: '125.000000' }],
    [{ monthlyBudgetCop: null, targetKwh: '125' }],
    [{ monthlyBudgetCop: '120000', targetKwh: null }],
    [{ monthlyBudgetCop: '999999999999.99', targetKwh: '99999999.999999' }],
  ])('acepta %p', async (body) => {
    await expect(errorsFor(body)).resolves.toEqual([]);
  });

  it('acepta ambos null en el DTO (la regla "al menos uno" es de dominio)', async () => {
    await expect(
      errorsFor({ monthlyBudgetCop: null, targetKwh: null }),
    ).resolves.toEqual([]);
  });

  it('rechaza campos omitidos: PUT es reemplazo completo', async () => {
    await expect(errorsFor({ targetKwh: '125' })).resolves.toEqual([
      'monthlyBudgetCop',
    ]);
    await expect(errorsFor({ monthlyBudgetCop: '1' })).resolves.toEqual([
      'targetKwh',
    ]);
  });

  it.each([['0'], ['-1'], ['1.123'], ['1000000000000'], [120000], ['1e5']])(
    'rechaza el presupuesto %p',
    async (monthlyBudgetCop) => {
      await expect(
        errorsFor({ monthlyBudgetCop, targetKwh: null }),
      ).resolves.toEqual(['monthlyBudgetCop']);
    },
  );

  it.each([['0.000000'], ['1.1234567'], ['100000000'], [125]])(
    'rechaza la meta %p',
    async (targetKwh) => {
      await expect(
        errorsFor({ monthlyBudgetCop: null, targetKwh }),
      ).resolves.toEqual(['targetKwh']);
    },
  );
});
