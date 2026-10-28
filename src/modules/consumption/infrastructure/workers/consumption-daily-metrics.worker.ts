import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

/**
 * Aggregate raw MQTT readings using an isolated smarthome_worker LOGIN.
 * No customer credentials, ingest credentials or app session context are reused.
 */
@Injectable()
export class ConsumptionDailyMetricsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConsumptionDailyMetricsWorker.name);
  private pool: Pool | null = null;
  private interval: NodeJS.Timeout | null = null;
  private running = false;

  async onModuleInit(): Promise<void> {
    if (process.env.CONSUMPTION_METRICS_WORKER_ENABLED !== 'true') {
      this.logger.log('Worker de mÃ©tricas deshabilitado; los resÃºmenes consultan lecturas crudas.');
      return;
    }

    const connectionString = process.env.DATABASE_METRICS_URL;
    if (!connectionString) throw new Error('DATABASE_METRICS_URL_REQUIRED');

    // Guard against accidentally running aggregates using the ingestion/app role.
    const metricsUrl = new URL(connectionString);
    const ingestUrl = new URL(process.env.DATABASE_IOT_URL ?? '');
    const appUrl = new URL(process.env.DATABASE_URL ?? '');
    if (
      !['postgres:', 'postgresql:'].includes(metricsUrl.protocol) ||
      !metricsUrl.username || !metricsUrl.hostname || metricsUrl.pathname === '/' ||
      metricsUrl.pathname !== ingestUrl.pathname ||
      metricsUrl.pathname !== appUrl.pathname ||
      metricsUrl.username === ingestUrl.username ||
      metricsUrl.username === appUrl.username
    ) throw new Error('DATABASE_METRICS_URL_ROLE_OR_DATABASE_INVALID');

    const pool = new Pool({ connectionString, max: 2, idleTimeoutMillis: 10000 });
    try {
      const role = await pool.query<{ authorized: boolean }>(
        "SELECT pg_has_role(current_user, 'smarthome_worker', 'USAGE') AS authorized",
      );
      if (role.rows[0]?.authorized !== true) throw new Error('DATABASE_METRICS_ROLE_REQUIRED');
      this.pool = pool;
      await this.refreshDailyMetrics(7);
      this.interval = setInterval(() => {
        void this.refreshDailyMetrics(1).catch((error: unknown) => {
          const code = error instanceof Error ? error.name : 'unknown';
          this.logger.error(`CONSUMPTION_METRICS_REFRESH_FAILED: ${code}`);
        });
      }, 60000);
      this.logger.log('Worker de mÃ©tricas iniciado (rol aislado smarthome_worker).');
    } catch (error) {
      this.pool = null;
      await pool.end();
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    if (this.pool) await this.pool.end();
    this.pool = null;
  }

  private async refreshDailyMetrics(daysBack: number): Promise<void> {
    if (!this.pool || this.running) return;
    this.running = true;
    try {
      const updated = await this.pool.query(
        `WITH daily AS (
           SELECT c.id_device, c.id_home,
                  date_trunc('day', c.read_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS start_at,
                  COALESCE(SUM(c.energy_delta_kwh), 0) AS kwh_total,
                  AVG(c.power_w) AS average_watts,
                  MAX(c.power_w) AS max_watts,
                  MIN(c.power_w) AS min_watts
             FROM consumption.consumption c
            WHERE c.read_at >= (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
                               - ($1::integer * INTERVAL '1 day')
              AND c.read_at < (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
                              + INTERVAL '1 day'
            GROUP BY c.id_device, c.id_home, start_at
         )
         INSERT INTO consumption.consumption_metric (
           id_device, id_home, period, start_at, end_at,
           kwh_total, average_watts, max_watts, min_watts
         )
         SELECT id_device, id_home, 'dia', start_at, start_at + INTERVAL '1 day',
                kwh_total, average_watts, max_watts, min_watts
           FROM daily
         ON CONFLICT (id_device, period, start_at)
         DO UPDATE SET kwh_total = EXCLUDED.kwh_total,
                       average_watts = EXCLUDED.average_watts,
                       max_watts = EXCLUDED.max_watts,
                       min_watts = EXCLUDED.min_watts`,
        [daysBack],
      );
      this.logger.debug(`MÃ©tricas diarias actualizadas: ${updated.rowCount ?? 0}`);
    } finally {
      this.running = false;
    }
  }
}
