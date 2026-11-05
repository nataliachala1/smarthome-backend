import {
  PgMqttPreparedConfirmationPort,
  type ConfirmMqttPreparedInput,
} from './pg-mqtt-prepared-confirmation.port';

const input: ConfirmMqttPreparedInput = {
  operationId: 'cb3c2441-6290-46d3-88d7-13e141c1f421',
  leaseToken: '7ac88c31-cd8e-4c4e-bb2b-82fbbe390384',
  identityId: '1e3c51b2-4f8a-4c3e-9a24-0acc5bf55e21',
  username: 'shd_1e3c51b24f8a4c3e9a240acc5bf55e21',
  clientId: 'shd-1e3c51b24f8a4c3e9a240acc5bf55e21',
  roleName: 'role_shd_1e3c51b24f8a4c3e9a240acc5bf55e21',
};

function harness(rows: unknown[] = [{ confirmed: true }]) {
  const query = jest.fn().mockResolvedValue({ rows });
  return { query, port: new PgMqttPreparedConfirmationPort({ query }) };
}

describe('PgMqttPreparedConfirmationPort / exclusivamente SQL 027', () => {
  it('invoca solo la funcion parametrizada y confirma true', async () => {
    const { port, query } = harness();
    await expect(port.confirm(input)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('fn_confirm_mqtt_pairing_prepared'),
      [input.operationId, input.leaseToken, input.identityId,
        input.username, input.clientId, input.roleName],
    );
  });

  it.each(['operationId', 'leaseToken', 'identityId'] as const)(
    'rechaza %s invalido antes de consultar', async (field) => {
      const { port, query } = harness();
      await expect(port.confirm({ ...input, [field]: 'malformed' }))
        .rejects.toThrow('MQTT_PREPARED_CONFIRM_INPUT_INVALID');
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each(['username', 'clientId', 'roleName'] as const)(
    'rechaza %s que no corresponda a la identidad', async (field) => {
      const { port, query } = harness();
      await expect(port.confirm({ ...input, [field]: 'other' }))
        .rejects.toThrow('MQTT_PREPARED_CONFIRM_BINDING_INVALID');
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([
    { caseName: 'sin filas', rows: [] },
    { caseName: 'confirmacion falsa', rows: [{ confirmed: false }] },
    { caseName: 'multiples filas', rows: [{ confirmed: true }, { confirmed: true }] },
    { caseName: 'confirmacion no booleana', rows: [{ confirmed: 'true' }] },
  ])('rechaza respuesta no confirmada: $caseName', async ({ rows }) => {
    const { port } = harness(rows);
    await expect(port.confirm(input))
      .rejects.toThrow('MQTT_PREPARED_CONFIRM_RESPONSE_INVALID');
  });

  it('trata fallo SQL o timeout como estado incierto', async () => {
    const { port, query } = harness();
    query.mockRejectedValueOnce(new Error('secret-database-message'));
    await expect(port.confirm(input)).rejects.toThrow('MQTT_PREPARED_CONFIRM_OUTCOME_UNKNOWN');
  });
});
