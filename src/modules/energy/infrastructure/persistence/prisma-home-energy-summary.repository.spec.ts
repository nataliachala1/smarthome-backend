jest.mock(
  '../../../../infrastructure/database/prisma/prisma-rls.service',
  () => ({
    PrismaRlsService: class PrismaRlsService {},
  }),
);

import type { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';
import { EnergyReadAccessDeniedError } from '../../domain/errors/energy.errors';
import { PrismaHomeEnergySummaryRepository } from './prisma-home-energy-summary.repository';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const HOME_ID = '22222222-2222-4222-8222-222222222222';
const PERIOD = {
  homeId: HOME_ID,
  month: '2026-11',
  from: new Date('2026-11-01T05:00:00.000Z'),
  to: new Date('2026-12-01T05:00:00.000Z'),
};

function fakeDatabase(allowed: boolean) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const tx = {
    $queryRaw: jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('$');
        queries.push({ sql, values });
        if (sql.includes('fn_can_read_detail')) {
          return Promise.resolve([{ allowed }]);
        }
        return Promise.resolve([
          {
            readings_count: 4,
            unpriced_readings: 0,
            total_kwh: '6.500000',
            priced_cost_cop: '7201.7500000000',
            monthly_budget_cop: '10000.00',
            target_kwh: null,
          },
        ]);
      },
    ),
  };
  const withUserContext = jest.fn(
    (_userId: string, operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  );

  return {
    rls: { withUserContext } as unknown as PrismaRlsService,
    queries,
    withUserContext,
  };
}

describe('PrismaHomeEnergySummaryRepository', () => {
  it('autoriza con fn_can_read_detail y luego calcula con la tarifa de la fecha local de cada lectura', async () => {
    const db = fakeDatabase(true);

    const facts = await new PrismaHomeEnergySummaryRepository(
      db.rls,
    ).getMonthFacts(USER_ID, PERIOD);

    expect(db.withUserContext).toHaveBeenCalledWith(
      USER_ID,
      expect.any(Function),
    );
    expect(db.queries).toHaveLength(2);
    expect(db.queries[0].sql).toContain('consumption.fn_can_read_detail');

    const summarySql = db.queries[1].sql;
    expect(summarySql).toContain('LEFT JOIN LATERAL');
    expect(summarySql).toContain("AT TIME ZONE 'America/Bogota'");
    expect(summarySql).toContain('tariff.effective_from <=');
    expect(summarySql).toContain('c.read_at >=');
    expect(summarySql).toContain('c.read_at <');
    // Instantes con zona explícita: no dependen de la zona horaria del servidor.
    expect(db.queries[1].values).toEqual([
      HOME_ID,
      '2026-11-01T05:00:00.000Z',
      '2026-12-01T05:00:00.000Z',
      HOME_ID,
      '2026-11-01',
    ]);
    expect(facts).toEqual({
      readingsCount: 4,
      unpricedReadings: 0,
      totalKwh: '6.500000',
      pricedCostCop: '7201.7500000000',
      monthlyBudgetCop: '10000.00',
      targetKwh: null,
    });
  });

  it('sin permiso de lectura: 403 sin consultar consumos ni tarifas', async () => {
    const db = fakeDatabase(false);

    await expect(
      new PrismaHomeEnergySummaryRepository(db.rls).getMonthFacts(
        USER_ID,
        PERIOD,
      ),
    ).rejects.toBeInstanceOf(EnergyReadAccessDeniedError);
    expect(db.queries).toHaveLength(1);
  });
});
