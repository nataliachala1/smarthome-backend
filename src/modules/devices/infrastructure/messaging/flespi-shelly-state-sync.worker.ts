import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { MqttRuntimeService } from './mqtt-runtime.service';
import { FlespiShellyStateReconciler } from './flespi-shelly-state.reconciler';

/**
 * Opt-in, single-replica DEV worker. Only runs when DevicesModule explicitly
 * registers it. Never switches the relay, writes energy or accepts HTTP input.
 * Bounded periodic reconciliation; failures are retried with capped backoff.
 */
@Injectable()
export class FlespiShellyStateSyncWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(FlespiShellyStateSyncWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private consecutiveErrors = 0;
  private retryNotBefore = 0;
  private readonly intervalMs: number;

  constructor(
    private readonly mqtt: MqttRuntimeService,
    private readonly reconciler: FlespiShellyStateReconciler,
  ) {
    const raw = process.env.SHELLY_FLESPI_STATE_SYNC_INTERVAL_SECONDS ?? '30';
    if (!/^(?:[1-9]\d*)$/.test(raw)) {
      throw new Error('SHELLY_FLESPI_STATE_SYNC_INTERVAL_SECONDS_INVALID');
    }
    const seconds = Number(raw);
    if (!Number.isSafeInteger(seconds) || seconds < 15 || seconds > 300) {
      throw new Error('SHELLY_FLESPI_STATE_SYNC_INTERVAL_SECONDS_INVALID');
    }
    this.intervalMs = seconds * 1_000;
  }

  onModuleInit(): void {
    const cfg = this.mqtt.config;
    if (!cfg.tls || cfg.brokerUrl !== 'mqtts://mqtt.flespi.io:8883' ||
        !cfg.flespiDeviceId || !cfg.namespace ||
        cfg.rpcSource !== `${cfg.namespace}/backend/${cfg.flespiDeviceId}` ||
        process.env.SHELLY_FLESPI_STATE_SYNC_SINGLE_REPLICA !== 'true') {
      throw new Error('SHELLY_FLESPI_STATE_SYNC_CONFIGURATION_INVALID');
    }
    this.logger.log(`Shelly DEV state reconciliation enabled, interval=${this.intervalMs / 1000}s`);
    this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs);
    void this.runOnce();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async runOnce(): Promise<void> {
    if (this.stopped || this.running || Date.now() < this.retryNotBefore) return;
    this.running = true;
    try {
      const result = await this.reconciler.reconcile();
      this.consecutiveErrors = 0;
      this.retryNotBefore = 0;
      if (result === 'updated') {
        this.logger.log('SHELLY_STATE_RECONCILED');
      } else if (result === 'not_found' || result === 'disabled') {
        // Avoid sustained queries for a device not registered in SmartHome.
        this.retryNotBefore = Date.now() + 300_000;
        this.logger.warn(`SHELLY_STATE_RECONCILE_${result.toUpperCase()}`);
      }
    } catch {
      // Never log token, MQTT payload, user identities or broker internals.
      this.consecutiveErrors++;
      const backoffMs = Math.min(300_000, this.intervalMs * 2 ** Math.min(this.consecutiveErrors - 1, 4));
      this.retryNotBefore = Date.now() + backoffMs;
      this.logger.warn('SHELLY_STATE_RECONCILE_RETRY_SCHEDULED');
    } finally {
      this.running = false;
    }
  }
}
