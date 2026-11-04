import {
  MqttReserverPgGateway,
  parseMqttReserverConnection,
  type ReserverPgPool,
} from './mqtt-reserver-pg.gateway';

const LAB_URL =
  'postgresql://smarthome_mqtt_reserver_lab_login:example%40secret@127.0.0.1:55432/smarthome_test';
const REMOTE_URL =
  'postgresql://smarthome_mqtt_reserver_prod_login:example%40secret@db.example.invalid:5432/smarthome_db';

const expectedRole = 'smarthome_mqtt_reserver_lab_login';
const expectedDatabase = 'smarthome_test';

function allowedPrivilegeRow() {
  return {
    role: expectedRole,
    database: expectedDatabase,
    can_reserve: true,
    can_register: false,
    can_revoke: false,
    can_read_operation: false,
    can_read_identity: false,
    registrar_member: false,
    revoke_member: false,
    is_superuser: false,
    bypass_rls: false,
    can_create_role: false,
    can_create_db: false,
  };
}

function fixture(row: unknown = allowedPrivilegeRow()) {
  const query = jest.fn().mockResolvedValue({ rows: [row] });
  const end = jest.fn().mockResolvedValue(undefined);
  const pool = { query, end } as ReserverPgPool;
  const gateway = new MqttReserverPgGateway(pool, {
    role: expectedRole,
    database: expectedDatabase,
  });
  return { query, end, gateway };
}

describe('MqttReserverPgGateway / configuracion segura', () => {
  it('acepta exclusivamente el destino local del laboratorio', () => {
    const cfg = parseMqttReserverConnection(LAB_URL, 'lab');
    expect(cfg.role).toBe(expectedRole);
    expect(cfg.database).toBe(expectedDatabase);
    expect(cfg.options.ssl).toBe(false);
  });

  it('rechaza destinos y usuarios privilegiados en modo laboratorio', () => {
    expect(() => parseMqttReserverConnection(REMOTE_URL, 'lab')).toThrow();
    expect(() => parseMqttReserverConnection(LAB_URL.replace('lab_login', 'registrar'), 'lab')).toThrow();
    expect(() => parseMqttReserverConnection(LAB_URL.replace('55432', '5432'), 'lab')).toThrow();
  });

  it('exige TLS verificado fuera del laboratorio', () => {
    const cfg = parseMqttReserverConnection(REMOTE_URL, 'remote-tls');
    expect(cfg.options.ssl).toEqual({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    expect(() => parseMqttReserverConnection(LAB_URL, 'remote-tls')).toThrow();
  });

  it('rechaza parametros URL que podrian modificar TLS y credenciales faltantes', () => {
    expect(() => parseMqttReserverConnection(`${REMOTE_URL}?sslmode=disable`, 'remote-tls')).toThrow();
    expect(() => parseMqttReserverConnection('postgresql://postgres:pwd@db.example.invalid:5432/smarthome_db', 'remote-tls')).toThrow();
    expect(() => parseMqttReserverConnection(undefined, 'lab')).toThrow();
  });
});

describe('MqttReserverPgGateway / barrera de privilegios', () => {
  it('no permite consultas antes de verificar la cuenta', async () => {
    const { query, gateway } = fixture();
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_RESERVER_NOT_READY');
    expect(query).not.toHaveBeenCalled();
  });

  it('habilita consultas despues de verificar la cuenta restringida', async () => {
    const { query, gateway } = fixture();
    await gateway.verifyPrivileges();
    query.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    await expect(gateway.query('SELECT $1::int', [1])).resolves.toEqual({ rows: [{ ok: 1 }] });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]).toEqual(['SELECT $1::int', [1]]);
  });

  it.each([
    ['rol de registro', { can_register: true }],
    ['rol de revocacion', { can_revoke: true }],
    ['tabla directa', { can_read_operation: true }],
    ['privilegio heredado registrar', { registrar_member: true }],
    ['privilegio heredado revoke', { revoke_member: true }],
    ['superusuario', { is_superuser: true }],
    ['bypass RLS', { bypass_rls: true }],
    ['puede crear roles', { can_create_role: true }],
    ['cuenta equivocada', { role: 'smarthome_mqtt_reserver_otro' }],
    ['base equivocada', { database: 'smarthome_db' }],
    ['sin permiso de reserva', { can_reserve: false }],
  ])('bloquea %s', async (_label, override) => {
    const { gateway } = fixture({ ...allowedPrivilegeRow(), ...override });
    await expect(gateway.verifyPrivileges()).rejects.toThrow('MQTT_RESERVER_PRIVILEGES_UNVERIFIED');
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_RESERVER_NOT_READY');
  });

  it('bloquea respuestas SQL mal formadas o fallos de conexion', async () => {
    const { gateway, query } = fixture();
    query.mockResolvedValueOnce({ rows: [] });
    await expect(gateway.verifyPrivileges()).rejects.toThrow('MQTT_RESERVER_PRIVILEGES_UNVERIFIED');
    query.mockRejectedValueOnce(new Error('secret=DO_NOT_LOG'));
    await expect(gateway.verifyPrivileges()).rejects.toThrow('MQTT_RESERVER_PRIVILEGES_UNVERIFIED');
  });

  it('cierra el pool y revoca disponibilidad al destruirse', async () => {
    const { gateway, end } = fixture();
    await gateway.verifyPrivileges();
    await gateway.onModuleDestroy();
    expect(end).toHaveBeenCalledTimes(1);
    await expect(gateway.query('SELECT 1', [])).rejects.toThrow('MQTT_RESERVER_NOT_READY');
  });
});
