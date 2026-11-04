// Local LAN tooling is opt-in and cannot be enabled on a production server.
export function shellyLocalEnabled(value: unknown, nodeEnv: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'string' || !['true', 'false'].includes(value.trim())) {
    throw new Error('SHELLY_LOCAL_ENABLED debe ser true o false.');
  }
  const enabled = value.trim() === 'true';
  if (enabled && nodeEnv === 'production') {
    throw new Error('SHELLY_LOCAL_ENABLED no puede habilitarse en producción.');
  }
  return enabled;
}
