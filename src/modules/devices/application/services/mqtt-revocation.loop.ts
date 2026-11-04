import { MqttRevocationWorker } from './mqtt-revocation.worker';

export type RevocationRunResult = Awaited<
  ReturnType<MqttRevocationWorker['runOnce']>
>;
export type RevocationLoopEvent =
  | RevocationRunResult
  | 'MQTT_REVOCATION_DATABASE_UNSAFE'
  | 'MQTT_REVOCATION_RUNTIME_UNAVAILABLE';

export class MqttRevocationDatabaseUnsafeError extends Error {
  constructor() {
    super('MQTT_REVOCATION_DATABASE_UNSAFE');
  }
}

/** Fixed delay AFTER completion. A slow cycle cannot overlap the next cycle. */
export class MqttRevocationLoop {
  private started = false;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<void>;
  private lastEvent: RevocationLoopEvent | null = null;
  private completed = 0;

  constructor(
    private readonly run: () => Promise<RevocationRunResult>,
    private readonly intervalMs: number,
    private readonly report: (event: RevocationLoopEvent) => void,
  ) {
    if (
      !Number.isSafeInteger(intervalMs) ||
      intervalMs < 250 ||
      intervalMs > 60000
    )
      throw new Error('MQTT_REVOCATION_POLL_INVALID');
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.schedule(0);
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.active = this.tick();
    }, delay);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    let event: RevocationLoopEvent;
    try {
      event = await this.run();
    } catch (error) {
      event =
        error instanceof MqttRevocationDatabaseUnsafeError
          ? 'MQTT_REVOCATION_DATABASE_UNSAFE'
          : 'MQTT_REVOCATION_RUNTIME_UNAVAILABLE';
    }
    this.lastEvent = event;
    if (event === 'REVOKED') this.completed++;
    // Diagnostic callbacks cannot create an unhandled rejection or stop retries.
    try {
      this.report(event);
    } catch {
      /* No external error text is exposed. */
    }
    if (!this.stopped) this.schedule(this.intervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.active;
  }

  status() {
    return {
      running: this.started && !this.stopped,
      lastEvent: this.lastEvent,
      completed: this.completed,
    };
  }
}
