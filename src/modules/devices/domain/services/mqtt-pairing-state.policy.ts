/**
 * HU16/HU11 — política estructural de transiciones de mqtt_pairing_operation.
 *
 * Este módulo es PURAMENTE DETERMINISTA: NO verifica credenciales, roles,
 * sesiones, pruebas de conexión MQTT, leases, tiempos ni transacciones SQL.
 * Nunca usar su resultado para escribir en BD sin funciones privilegiadas que
 * verifiquen cada precondición y evidencia del broker.
 */
export const MQTT_PAIRING_STATUSES = [
  'RESERVED',
  'PREPARING',
  'PREPARED_DISABLED',
  'ENABLE_PENDING',
  'ENABLING',
  'AWAITING_AUTH',
  'AUTH_VERIFIED',
  'ATTACHED',
  'REVOKE_PENDING',
  'REVOKING',
  'REVOKED',
  'RECONCILIATION_REQUIRED',
] as const;

export type MqttPairingStatus = (typeof MQTT_PAIRING_STATUSES)[number];

/** Los nombres son hechos exigidos al actor confiable, no pruebas en sí mismos. */
export type MqttPairingEvent =
  | 'PREPARATION_LEASE_CLAIMED'
  | 'BROKER_DISABLED_AND_ACLS_VERIFIED'
  | 'ENABLE_REQUESTED'
  | 'ENABLE_LEASE_CLAIMED'
  | 'BROKER_ENABLE_VERIFIED'
  | 'BROKER_AUTH_SESSION_VERIFIED'
  | 'DEVICE_AND_IDENTITY_ATTACHED_ATOMICALLY'
  | 'REVOKE_REQUESTED'
  | 'REVOCATION_LEASE_CLAIMED'
  | 'BROKER_REVOCATION_VERIFIED'
  | 'BROKER_ADMIN_OUTCOME_UNKNOWN'
  | 'TRUSTED_RECONCILIATION_REQUESTS_REVOCATION';

type Rule = Readonly<{
  from: MqttPairingStatus;
  event: MqttPairingEvent;
  to: MqttPairingStatus;
}>;

/**
 * Tabla cerrada por defecto: cualquier par estado/evento ausente está prohibido.
 * Nunca expresa éxito de una llamada remota; solo clasifica la transición.
 */
export const MQTT_PAIRING_TRANSITION_RULES: readonly Rule[] = [
  { from: 'RESERVED', event: 'PREPARATION_LEASE_CLAIMED', to: 'PREPARING' },
  { from: 'PREPARING', event: 'BROKER_DISABLED_AND_ACLS_VERIFIED', to: 'PREPARED_DISABLED' },
  { from: 'PREPARED_DISABLED', event: 'ENABLE_REQUESTED', to: 'ENABLE_PENDING' },
  { from: 'ENABLE_PENDING', event: 'ENABLE_LEASE_CLAIMED', to: 'ENABLING' },
  { from: 'ENABLING', event: 'BROKER_ENABLE_VERIFIED', to: 'AWAITING_AUTH' },
  { from: 'AWAITING_AUTH', event: 'BROKER_AUTH_SESSION_VERIFIED', to: 'AUTH_VERIFIED' },
  { from: 'AUTH_VERIFIED', event: 'DEVICE_AND_IDENTITY_ATTACHED_ATOMICALLY', to: 'ATTACHED' },
  { from: 'REVOKE_PENDING', event: 'REVOCATION_LEASE_CLAIMED', to: 'REVOKING' },
  { from: 'REVOKING', event: 'BROKER_REVOCATION_VERIFIED', to: 'REVOKED' },
  { from: 'RECONCILIATION_REQUIRED', event: 'TRUSTED_RECONCILIATION_REQUESTS_REVOCATION', to: 'REVOKE_PENDING' },
  // Una solicitud de desvinculación debe ser atendible aun si quedó trabajo
  // anterior en curso; nunca implica que el broker ya esté revocado.
  ...([
    'RESERVED', 'PREPARING', 'PREPARED_DISABLED', 'ENABLE_PENDING',
    'ENABLING', 'AWAITING_AUTH', 'AUTH_VERIFIED', 'ATTACHED',
  ] as const).map((from): Rule => ({
    from,
    event: 'REVOKE_REQUESTED',
    to: 'REVOKE_PENDING',
  })),
  // El resultado desconocido NUNCA puede contarse como éxito.
  ...([
    'PREPARING', 'ENABLING', 'REVOKING',
  ] as const).map((from): Rule => ({
    from,
    event: 'BROKER_ADMIN_OUTCOME_UNKNOWN',
    to: 'RECONCILIATION_REQUIRED',
  })),
] as const;

const rules = new Map<string, MqttPairingStatus>();
for (const rule of MQTT_PAIRING_TRANSITION_RULES) {
  const key = `${rule.from}|${rule.event}`;
  if (rules.has(key)) throw new Error('MQTT_PAIRING_DUPLICATE_POLICY_RULE');
  rules.set(key, rule.to);
}

export function isMqttPairingTransitionAllowed(
  current: MqttPairingStatus,
  event: MqttPairingEvent,
): boolean {
  return rules.has(`${current}|${event}`);
}

export function nextMqttPairingStatus(
  current: MqttPairingStatus,
  event: MqttPairingEvent,
): MqttPairingStatus {
  const next = rules.get(`${current}|${event}`);
  if (!next) throw new Error('MQTT_PAIRING_STATE_TRANSITION_DENIED');
  return next;
}
