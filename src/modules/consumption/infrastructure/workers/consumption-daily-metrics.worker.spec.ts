import { Pool } from 'pg';
import { ConsumptionDailyMetricsWorker } from './consumption-daily-metrics.worker';

jest.mock('pg', () => ({ Pool: jest.fn() }));

describe('ConsumptionDailyMetricsWorker', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.clearAllMocks();
  });

  it('no inicia una conexiÃ³n si el worker no estÃ¡ habilitado', async () => {
    delete process.env.CONSUMPTION_METRICS_WORKER_ENABLED;
    const worker = new ConsumptionDailyMetricsWorker();
    await worker.onModuleInit();
    expect(Pool).not.toHaveBeenCalled();
    await worker.onModuleDestroy();
  });

  it('falla cerrado sin credencial dedicada', async () => {
    process.env.CONSUMPTION_METRICS_WORKER_ENABLED = 'true';
    delete process.env.DATABASE_METRICS_URL;
    const worker = new ConsumptionDailyMetricsWorker();
    await expect(worker.onModuleInit()).rejects.toThrow('DATABASE_METRICS_URL_REQUIRED');
    expect(Pool).not.toHaveBeenCalled();
  });

  it('exige rol worker y calcula mÃ©tricas desde lecturas crudas', async () => {
    process.env.CONSUMPTION_METRICS_WORKER_ENABLED = 'true';
    process.env.DATABASE_METRICS_URL = 'postgresql://metrics_worker:test@db:5432/smarthome';
    process.env.DATABASE_IOT_URL = 'postgresql://ingest:test@db:5432/smarthome';
    process.env.DATABASE_URL = 'postgresql://app:test@db:5432/smarthome';
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ authorized: true }] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const end = jest.fn().mockResolvedValue(undefined);
    (Pool as unknown as jest.Mock).mockImplementation(() => ({ query, end }));
    const worker = new ConsumptionDailyMetricsWorker();
    await worker.onModuleInit();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('pg_has_role');
    expect(query.mock.calls[1][0]).toContain('consumption.consumption_metric');
    await worker.onModuleDestroy();
    expect(end).toHaveBeenCalledTimes(1);
  });
});
