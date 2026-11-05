import { createHash } from 'node:crypto';

/**
 * SQL035 identifies reproducible Shelly RPC notifications, not MQTT packets.
 * The Shelly params.ts value alone is NOT a guaranteed event identifier.
 * A canonical component payload and method must also match to deduplicate.
 * Frames without a trustworthy origin timestamp are state-only.
 */
export interface FlespiShellyEventIdentity {
  eventKey: string;
  deviceEventTs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((k) =>
      `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function identifyFlespiShellyEvent(
  topic: string,
  payload: Buffer,
  switchId: number,
): FlespiShellyEventIdentity | null {
  if (!topic.endsWith('/events/rpc')) return null;
  try {
    const frame: unknown = JSON.parse(payload.toString('utf8'));
    if (!isRecord(frame) ||
        (frame.method !== 'NotifyStatus' && frame.method !== 'NotifyFullStatus') ||
        !isRecord(frame.params)) return null;

    const ts = frame.params.ts;
    const component = frame.params[`switch:${switchId}`];
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0 ||
        !isRecord(component) || Object.keys(component).length === 0) return null;

    const canonical = canonicalJson(component);
    const identity = JSON.stringify(['flespi-shelly-notify-v1', topic, frame.method, ts, canonical]);
    return {
      eventKey: createHash('sha256').update(identity).digest('hex'),
      deviceEventTs: ts,
    };
  } catch {
    return null;
  }
}
