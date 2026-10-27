import { PgMqttPreparationLeasePort } from './pg-mqtt-preparation-lease.port';

const operationId = 'cb3c2441-6290-46d3-88d7-13e141c1f421';
const leaseToken = '7ac88c31-cd8e-4c4e-bb2b-82fbbe390384';

function harness(rows: unknown[] = [{
  operationId, leaseToken,
  expiresAt: new Date(Date.now() + 60_000), attemptNumber: 1,
}]) {
  const query = jest.fn().mockResolvedValue({ rows });
  return { port: new PgMqttPreparationLeasePort({ query }), query };
}

describe('PgMqttPreparationLeasePort / SQL 025', () => {
  it('reclama solo SQL 025, con parametros y token cercado', async () => {
    const { port, query } = harness();
    await expect(port.claim(operationId, 60)).resolves.toEqual({ operationId, leaseToken });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('fn_claim_mqtt_pairing_preparation'),
      [operationId, 60],
    );
  });

  it.each([0, -1, 301, 1.5])('rechaza segundos invalidos: %s', async (seconds) => {
    const { port, query } = harness();
    await expect(port.claim(operationId, seconds)).rejects.toThrow('MQTT_LEASE_CLAIM_INPUT_INVALID');
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'sin filas', rows: [] },
    { name: 'duplicadas', rows: [{ operationId, leaseToken, expiresAt: new Date(Date.now() + 60_000), attemptNumber: 1 }, { operationId, leaseToken, expiresAt: new Date(Date.now() + 60_000), attemptNumber: 1 }] },
    { name: 'token invalido', rows: [{ operationId, leaseToken: 'bad', expiresAt: new Date(Date.now() + 60_000), attemptNumber: 1 }] },
    { name: 'lease vencido', rows: [{ operationId, leaseToken, expiresAt: new Date(Date.now() - 60_000), attemptNumber: 1 }] },
  ])('rechaza respuesta $name', async ({ rows }) => {
    const { port } = harness(rows);
    await expect(port.claim(operationId, 60)).rejects.toThrow('MQTT_LEASE_CLAIM_RESPONSE_INVALID');
  });

  it('falla cerrado si la llamada de claim pierde su respuesta', async () => {
    const { port, query } = harness();
    query.mockRejectedValueOnce(new Error('timeout'));
    await expect(port.claim(operationId, 60)).rejects.toThrow('MQTT_LEASE_CLAIM_OUTCOME_UNKNOWN');
  });

  it('reporta incertidumbre con codigo permitido por SQL 025, nunca exito', async () => {
    const { port, query } = harness([{ reported: true }]);
    await expect(port.reportUncertain(operationId, leaseToken)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('fn_report_mqtt_pairing_uncertain'),
      [operationId, leaseToken, 'MQTT_ADMIN_OUTCOME_UNKNOWN'],
    );
  });

  it('no trata una respuesta false como confirmacion de incertidumbre', async () => {
    const { port } = harness([{ reported: false }]);
    await expect(port.reportUncertain(operationId, leaseToken))
      .rejects.toThrow('MQTT_LEASE_REPORT_RESPONSE_INVALID');
  });
});
