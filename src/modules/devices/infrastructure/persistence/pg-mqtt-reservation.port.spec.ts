import { PgMqttReservationPort } from './pg-mqtt-reservation.port';

const sessionId = '9e7dc4d2-d05f-4a6e-8453-57b74cebd41d';
const operationId = '7b43528e-8b8e-49a2-af58-3b97dcf092da';
const identityId = 'f3a9e158-914e-4a8a-ae33-a94b2f80dd4c';
const suffix = identityId.replace(/-/g, '');
const scope = 'smarthome/devices/shelly1pmg4-aabbccddeeff';
const actorId = '0a9c4a58-1825-49f1-b388-1e5a8ab2f05c';
const tokenProofHash = 'a'.repeat(64);
const validRow = {
  operationId,
  identityId,
  username: `shd_${suffix}`,
  clientId: `shd-${suffix}`,
  roleName: `role_shd_${suffix}`,
  reservedTopicScope: scope,
};

function setup(rows: unknown[] = [validRow]) {
  const query = jest.fn().mockResolvedValue({ rows });
  return { query, port: new PgMqttReservationPort({ query }) };
}

describe('PgMqttReservationPort / acceso privilegiado solo-reserva', () => {
  it('ejecuta una sola consulta parametrizada y devuelve el enlace verificado', async () => {
    const { port, query } = setup();
    await expect(port.reserve(sessionId, scope, actorId, tokenProofHash)).resolves.toEqual(validRow);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, args] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('devices.fn_reserve_mqtt_pairing_operation($1::uuid, $2::text, $3::uuid, $4::text)');
    expect(sql).not.toContain(sessionId);
    expect(sql).not.toContain(scope);
    expect(args).toEqual([sessionId, scope, actorId, tokenProofHash]);
  });

  it('rechaza UUID invalido antes de llamar PostgreSQL', async () => {
    const { port, query } = setup();
    await expect(port.reserve('invalido', scope, actorId, tokenProofHash)).rejects.toThrow('MQTT_REGISTRAR_SESSION_ID_INVALID');
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['#', '$CONTROL/dynamic-security/v1',
    'smarthome/devices/otro-dispositivo',
    'smarthome/devices/shelly1pmg4-test/#', ''])(
    'rechaza scope incorrecto: %s', async (unsafe) => {
    const { port, query } = setup();
    await expect(port.reserve(sessionId, unsafe, actorId, tokenProofHash)).rejects.toThrow('MQTT_REGISTRAR_TOPIC_SCOPE_INVALID');
    expect(query).not.toHaveBeenCalled();
  });

  it('rechaza respuestas ausentes o multiples', async () => {
    await expect(setup([]).port.reserve(sessionId, scope, actorId, tokenProofHash)).rejects.toThrow('MQTT_REGISTRAR_INVALID_RESPONSE');
    await expect(setup([validRow, validRow]).port.reserve(sessionId, scope, actorId, tokenProofHash)).rejects.toThrow('MQTT_REGISTRAR_INVALID_RESPONSE');
  });

  it('rechaza el scope y los nombres del broker manipulados en la respuesta', async () => {
    await expect(setup([{ ...validRow, reservedTopicScope: 'shelly1pmg4-other' }]).port.reserve(sessionId, scope, actorId, tokenProofHash))
      .rejects.toThrow('MQTT_REGISTRAR_INVALID_RESPONSE');
    await expect(setup([{ ...validRow, clientId: 'backend-admin' }]).port.reserve(sessionId, scope, actorId, tokenProofHash))
      .rejects.toThrow('MQTT_REGISTRAR_INVALID_RESPONSE');
    await expect(setup([{ ...validRow, identityId: 'not-a-uuid' }]).port.reserve(sessionId, scope, actorId, tokenProofHash))
      .rejects.toThrow('MQTT_REGISTRAR_INVALID_RESPONSE');
  });

  it('falla cerrado sin filtrar mensajes internos de PostgreSQL', async () => {
    const { port, query } = setup();
    query.mockRejectedValueOnce(new Error('password=NO_MOSTRAR host=internal'));
    await expect(port.reserve(sessionId, scope, actorId, tokenProofHash)).rejects.toThrow('MQTT_REGISTRAR_RESERVATION_FAILED');
  });
  it('rechaza pruebas de autenticacion invalidas antes de consultar PostgreSQL', async () => {
    const { port, query } = setup();
    await expect(port.reserve(sessionId, scope, 'usuario-falso', tokenProofHash))
      .rejects.toThrow('MQTT_REGISTRAR_AUTH_PROOF_INVALID');
    await expect(port.reserve(sessionId, scope, actorId, 'invalid-hash'))
      .rejects.toThrow('MQTT_REGISTRAR_AUTH_PROOF_INVALID');
    expect(query).not.toHaveBeenCalled();
  });

});
