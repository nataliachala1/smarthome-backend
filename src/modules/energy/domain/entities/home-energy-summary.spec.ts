import {
  EnergyMonthFacts,
  buildHomeEnergySummary,
} from './home-energy-summary';

const base = {
  homeId: '22222222-2222-4222-8222-222222222222',
  month: '2026-11',
  timezone: 'America/Bogota',
  from: new Date('2026-11-01T05:00:00.000Z'),
  to: new Date('2026-12-01T05:00:00.000Z'),
};

function build(facts: Partial<EnergyMonthFacts>) {
  return buildHomeEnergySummary({
    ...base,
    facts: {
      readingsCount: 4,
      unpricedReadings: 0,
      totalKwh: '6.500000',
      pricedCostCop: '7201.7500000000',
      monthlyBudgetCop: '10000.00',
      targetKwh: '5.000000',
      ...facts,
    },
  });
}

describe('buildHomeEnergySummary', () => {
  it('con tarifa para todas las lecturas: costo estimado y avance', () => {
    const summary = build({});

    expect(summary).toMatchObject({
      totalKwh: '6.500000',
      costComplete: true,
      estimatedCostCop: '7201.75',
      partialCostCop: '7201.75',
      budgetUsagePercent: '72.02',
      targetUsagePercent: '130.00',
      currency: 'COP',
    });
  });

  it('con lecturas sin tarifa: no presenta el costo parcial como total', () => {
    const summary = build({ unpricedReadings: 2, pricedCostCop: '1000.5' });

    expect(summary.costComplete).toBe(false);
    expect(summary.estimatedCostCop).toBeNull();
    expect(summary.partialCostCop).toBe('1000.50');
    expect(summary.budgetUsagePercent).toBeNull();
    expect(summary.targetUsagePercent).toBe('130.00');
  });

  it('sin presupuesto ni meta: porcentajes en null', () => {
    const summary = build({ monthlyBudgetCop: null, targetKwh: null });

    expect(summary.budgetUsagePercent).toBeNull();
    expect(summary.targetUsagePercent).toBeNull();
  });

  it('mes sin lecturas: 0 kWh y costo 0 con cobertura completa', () => {
    const summary = build({
      readingsCount: 0,
      totalKwh: '0',
      pricedCostCop: '0',
      monthlyBudgetCop: null,
      targetKwh: null,
    });

    expect(summary).toMatchObject({
      readingsCount: 0,
      totalKwh: '0.000000',
      costComplete: true,
      estimatedCostCop: '0.00',
    });
  });
});
