import { PgMqttRpcChallengePort, PgMqttAuthConfirmPort } from './pg-mqtt-authentication.ports';
const op = 'd73bb6ab-d11c-4ead-80e1-ccf714b48923';
const rpc = '35bb8cd2-cd14-4d5a-ad75-2d496e90945a';

describe('Etapa 1: puertos separados SQL026 y SQL029', () => {
  it('no ejecuta SQL arbitrario, solo plantillas fijas y parametros', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ confirmed: true }] });
    const sut = new PgMqttAuthConfirmPort({ query });
    await sut.confirm(op, rpc, { username: 'shd_abcd', clientId: 'shd-abcd', roleName: 'role_shd_abcd' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('fn_confirm_mqtt_broker_authentication'),
      [op, rpc, 'shd_abcd', 'shd-abcd', 'role_shd_abcd'],
    );
  });
  it('no ejecuta SQL con identificadores de operacion invalidos', async () => {
    const query = jest.fn();
    const sut = new PgMqttRpcChallengePort({ query });
    await expect(sut.consume('no-uuid', rpc)).rejects.toThrow('ARGUMENTS_INVALID');
    expect(query).not.toHaveBeenCalled();
  });
  it('no infiere exito de consulta SQL con respuesta incierta', async () => {
    const sut = new PgMqttAuthConfirmPort({ query: () => Promise.resolve({ rows: [{ confirmed: false }] }) });
    await expect(sut.confirm(op, rpc, {
      username: 'shd_abcd', clientId: 'shd-abcd', roleName: 'role_shd_abcd',
    })).rejects.toThrow('NOT_CONFIRMED');
  });
});
