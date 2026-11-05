import { randomUUID } from 'node:crypto';
import type { IPublishPacket, MqttClient } from 'mqtt';

export const DYNAMIC_SECURITY_TOPIC = '$CONTROL/dynamic-security/v1';
export const DYNAMIC_SECURITY_REPLY = `${DYNAMIC_SECURITY_TOPIC}/response`;

export class BrokerAdminError extends Error {
  constructor(
    readonly code:
      | 'MQTT_ADMIN_UNAVAILABLE'
      | 'MQTT_ADMIN_REJECTED'
      | 'MQTT_ADMIN_OUTCOME_UNKNOWN'
      | 'MQTT_ADMIN_INVALID_RESPONSE'
      | 'MQTT_ADMIN_UNSAFE_DEFAULT_ACL',
  ) {
    super(code);
  }
}

export type AdminCommand = { command: string } & Record<string, unknown>;
export interface BrokerAdminTransport {
  execute(command: AdminCommand): Promise<unknown>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface PendingCommand {
  command: string;
  sent: boolean;
  resolve: (data: unknown) => void;
  reject: (error: BrokerAdminError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Explicitly constructed with a dedicated, already connected admin client.
 * No environment reads, connection creation, logging or automatic retries.
 */
export class MosquittoAdminTransport implements BrokerAdminTransport {
  private readonly pending = new Map<string, PendingCommand>();
  private closed = false;

  constructor(
    private readonly client: MqttClient,
    private readonly timeoutMs = 5000,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
      throw new Error('MQTT_ADMIN_TIMEOUT_INVALID');
    if (
      client.options.protocol !== 'mqtts' ||
      client.options.rejectUnauthorized !== true
    ) {
      throw new Error('MQTT_ADMIN_TLS_REQUIRED');
    }
    if (client.options.reconnectPeriod !== 0 || client.options.clean !== true) {
      throw new Error('MQTT_ADMIN_SESSION_UNSAFE');
    }
    client.on('message', this.onMessage);
    client.on('close', this.onClose);
    client.on('error', this.onClose);
  }

  execute(command: AdminCommand): Promise<unknown> {
    if (this.closed || !this.client.connected)
      return Promise.reject(new BrokerAdminError('MQTT_ADMIN_UNAVAILABLE'));
    if (this.pending.size >= 32)
      return Promise.reject(new BrokerAdminError('MQTT_ADMIN_UNAVAILABLE'));
    const correlationData = randomUUID();
    return new Promise((resolve, reject) => {
      const pending: PendingCommand = {
        command: command.command,
        sent: false,
        resolve,
        reject,
        timer: setTimeout(
          () => this.fail(correlationData, 'MQTT_ADMIN_OUTCOME_UNKNOWN'),
          this.timeoutMs,
        ),
      };
      this.pending.set(correlationData, pending);
      try {
        // Deadline includes SUBACK; no command is sent until subscription succeeds.
        this.client.subscribe(
          DYNAMIC_SECURITY_REPLY,
          { qos: 1 },
          (error, granted) => {
            if (!this.pending.has(correlationData)) return;
            if (
              error ||
              !granted?.some(
                (grant) =>
                  grant.topic === DYNAMIC_SECURITY_REPLY &&
                  Number(grant.qos) <= 2,
              )
            ) {
              this.fail(correlationData, 'MQTT_ADMIN_UNAVAILABLE');
              return;
            }
            pending.sent = true;
            try {
              this.client.publish(
                DYNAMIC_SECURITY_TOPIC,
                JSON.stringify({ commands: [{ ...command, correlationData }] }),
                { qos: 1, retain: false },
                (publishError) => {
                  if (publishError)
                    this.fail(correlationData, 'MQTT_ADMIN_OUTCOME_UNKNOWN');
                },
              );
            } catch {
              this.fail(correlationData, 'MQTT_ADMIN_OUTCOME_UNKNOWN');
            }
          },
        );
      } catch {
        this.fail(correlationData, 'MQTT_ADMIN_UNAVAILABLE');
      }
    });
  }

  private readonly onMessage = (
    topic: string,
    payload: Buffer,
    packet: IPublishPacket,
  ): void => {
    if (
      topic !== DYNAMIC_SECURITY_REPLY ||
      packet.retain ||
      payload.length > 65536
    )
      return;
    let response: unknown;
    try {
      response = JSON.parse(payload.toString('utf8'));
    } catch {
      return;
    }
    if (!record(response) || !Array.isArray(response.responses)) return;
    for (const item of response.responses) {
      if (!record(item) || typeof item.correlationData !== 'string') continue;
      const pending = this.pending.get(item.correlationData);
      if (!pending || !pending.sent) continue;
      if (item.command !== pending.command) {
        this.fail(item.correlationData, 'MQTT_ADMIN_INVALID_RESPONSE');
      } else if (Object.hasOwn(item, 'error')) {
        this.fail(item.correlationData, 'MQTT_ADMIN_REJECTED');
      } else {
        this.pending.delete(item.correlationData);
        clearTimeout(pending.timer);
        pending.resolve(item.data);
      }
    }
  };

  private fail(id: string, code: BrokerAdminError['code']): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(
      new BrokerAdminError(pending.sent ? code : 'MQTT_ADMIN_UNAVAILABLE'),
    );
  }

  private readonly onClose = (): void => {
    // Discard this transport after a connection failure. A new dedicated client
    // is required, so application code cannot silently replay uncertain changes.
    this.closed = true;
    for (const id of this.pending.keys())
      this.fail(id, 'MQTT_ADMIN_OUTCOME_UNKNOWN');
  };

  close(): void {
    this.closed = true;
    this.onClose();
    this.client.off('message', this.onMessage);
    this.client.off('close', this.onClose);
    this.client.off('error', this.onClose);
  }
}
