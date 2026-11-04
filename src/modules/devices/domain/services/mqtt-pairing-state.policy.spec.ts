import {
  MQTT_PAIRING_STATUSES,
  MQTT_PAIRING_TRANSITION_RULES,
  isMqttPairingTransitionAllowed,
  nextMqttPairingStatus,
  type MqttPairingStatus,
} from './mqtt-pairing-state.policy';

describe('HU16 MQTT pairing / política de transiciones (SIN efectos)', () => {
  it('cubre exactamente los estados permitidos por la migración 022', () => {
    expect([...MQTT_PAIRING_STATUSES]).toEqual([
      'RESERVED', 'PREPARING', 'PREPARED_DISABLED',
      'ENABLE_PENDING', 'ENABLING', 'AWAITING_AUTH', 'AUTH_VERIFIED',
      'ATTACHED', 'REVOKE_PENDING', 'REVOKING', 'REVOKED',
      'RECONCILIATION_REQUIRED',
    ]);
  });

  it('representa el recorrido estructural, sin afirmar éxito de broker', () => {
    const path = [
      ['PREPARATION_LEASE_CLAIMED', 'PREPARING'],
      ['BROKER_DISABLED_AND_ACLS_VERIFIED', 'PREPARED_DISABLED'],
      ['ENABLE_REQUESTED', 'ENABLE_PENDING'],
      ['ENABLE_LEASE_CLAIMED', 'ENABLING'],
      ['BROKER_ENABLE_VERIFIED', 'AWAITING_AUTH'],
      ['BROKER_AUTH_SESSION_VERIFIED', 'AUTH_VERIFIED'],
      ['DEVICE_AND_IDENTITY_ATTACHED_ATOMICALLY', 'ATTACHED'],
      ['REVOKE_REQUESTED', 'REVOKE_PENDING'],
      ['REVOCATION_LEASE_CLAIMED', 'REVOKING'],
      ['BROKER_REVOCATION_VERIFIED', 'REVOKED'],
    ] as const;
    let status: MqttPairingStatus = 'RESERVED';
    for (const [event, expected] of path) {
      status = nextMqttPairingStatus(status, event);
      expect(status).toBe(expected);
    }
  });

  it.each([
    ['RESERVED', 'BROKER_AUTH_SESSION_VERIFIED'],
    ['RESERVED', 'BROKER_ENABLE_VERIFIED'],
    ['AWAITING_AUTH', 'DEVICE_AND_IDENTITY_ATTACHED_ATOMICALLY'],
    ['ENABLING', 'BROKER_AUTH_SESSION_VERIFIED'],
    ['REVOKE_PENDING', 'BROKER_REVOCATION_VERIFIED'],
    ['REVOKING', 'DEVICE_AND_IDENTITY_ATTACHED_ATOMICALLY'],
    ['RECONCILIATION_REQUIRED', 'ENABLE_REQUESTED'],
    ['REVOKED', 'PREPARATION_LEASE_CLAIMED'],
    ['REVOKED', 'ENABLE_REQUESTED'],
    ['REVOKED', 'REVOKE_REQUESTED'],
  ] as const)('deniega el salto inseguro %s + %s', (from, event) => {
    expect(isMqttPairingTransitionAllowed(from, event)).toBe(false);
    expect(() => nextMqttPairingStatus(from, event))
      .toThrow('MQTT_PAIRING_STATE_TRANSITION_DENIED');
  });

  it('solamente una verificación estructural de broker lleva a REVOKED', () => {
    expect(nextMqttPairingStatus('REVOKING', 'BROKER_REVOCATION_VERIFIED'))
      .toBe('REVOKED');
    expect(() => nextMqttPairingStatus('REVOKING', 'BROKER_ENABLE_VERIFIED'))
      .toThrow('MQTT_PAIRING_STATE_TRANSITION_DENIED');
  });

  it('un resultado administrativo desconocido exige reconciliación', () => {
    for (const state of ['PREPARING', 'ENABLING', 'REVOKING'] as const) {
      expect(nextMqttPairingStatus(state, 'BROKER_ADMIN_OUTCOME_UNKNOWN'))
        .toBe('RECONCILIATION_REQUIRED');
    }
    expect(() => nextMqttPairingStatus('RECONCILIATION_REQUIRED', 'BROKER_ADMIN_OUTCOME_UNKNOWN'))
      .toThrow('MQTT_PAIRING_STATE_TRANSITION_DENIED');
  });

  it('no habilita después de una reconciliación: exige revocación', () => {
    expect(nextMqttPairingStatus(
      'RECONCILIATION_REQUIRED',
      'TRUSTED_RECONCILIATION_REQUESTS_REVOCATION',
    )).toBe('REVOKE_PENDING');
  });

  it('no permite reglas duplicadas ni destinos fuera del catálogo', () => {
    const keys = MQTT_PAIRING_TRANSITION_RULES.map((rule) => `${rule.from}|${rule.event}`);
    expect(new Set(keys).size).toBe(keys.length);
    const valid = new Set<string>(MQTT_PAIRING_STATUSES);
    for (const rule of MQTT_PAIRING_TRANSITION_RULES) {
      expect(valid.has(rule.from)).toBe(true);
      expect(valid.has(rule.to)).toBe(true);
    }
  });
});
