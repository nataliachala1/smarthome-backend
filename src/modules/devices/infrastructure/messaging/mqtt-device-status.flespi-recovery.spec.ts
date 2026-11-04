// Etapa 3D.3-A: política fail-closed ante timestamps ambiguos y reinicio
// del contador. Este archivo prueba el subscriber real con transacciones
// simuladas. El paquete incluye una integración PostgreSQL independiente.
jest.mock('./mqtt-runtime.service', () => ({ MqttRuntimeService: class {} }));
jest.mock('../../../../infrastructure/database/prisma/prisma-iot.service', () => ({ PrismaIotService: class {} }));
jest.mock('../../../../infrastructure/database/prisma/prisma-rls.service', () => ({ PrismaRlsService: class {} }));
jest.mock('../../../realtime/realtime-events.service', () => ({ RealtimeEventsService: class {} }));

import { MqttDeviceStatusSubscriber } from './mqtt-device-status.subscriber';
import { identifyFlespiShellyEvent } from './flespi-shelly-event-key';

const DEVICE = 'shelly1pmg4-d885acf06990';
const TOPIC = `smarthome/dev/v1/devices/${DEVICE}/events/rpc`;
const frame = (ts: number, output: boolean, watts: number, totalWh: number) =>
  Buffer.from(JSON.stringify({
    src: DEVICE,
    method: 'NotifyStatus',
    params: {
      ts,
      'switch:0': { output, apower: watts, aenergy: { total: totalWh } },
    },
  }));

type Options = { watermark?: number; previousKwh?: number; latestReadAt?: Date };
function setup({ watermark, previousKwh, latestReadAt }: Options = {}) {
  const emitToUser = jest.fn();
  const tx = {
    $queryRaw: jest.fn().mockImplementation((sql: TemplateStringsArray, ...values: unknown[]) => {
      const statement = sql.join('?');
      if (/FOR UPDATE/.test(statement)) return Promise.resolve([{ id_device: 'device-1' }]);
      if (/SELECT device_event_ts/.test(statement)) {
        const incomingTs = Number(values[1]);
        return Promise.resolve(watermark !== undefined && watermark >= incomingTs
          ? [{ device_event_ts: watermark }] : []);
      }
      if (/INSERT INTO consumption\.mqtt_ingest_dedup/.test(statement))
        return Promise.resolve([{ id_device: 'device-1' }]);
      if (/SELECT energy_total_kwh/.test(statement))
        return Promise.resolve([{ energy_total_kwh: previousKwh ?? null, latest_read_at: latestReadAt ?? null }]);
      throw new Error(`Unexpected SQL 3D.3: ${statement}`);
    }),
    device: { update: jest.fn().mockImplementation(({ data }: { data: { is_on: boolean; current_power_w: number | null } }) => Promise.resolve({
      id_device: 'device-1', id_home: 'home-1', connectivity_status: 'ONLINE',
      is_on: data.is_on, current_power_w: data.current_power_w,
      updated_at: new Date('2026-10-30T20:00:00Z'),
    })) },
    consumption: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    device: { findFirst: jest.fn().mockResolvedValue({
      id_device: 'device-1', id_home: 'home-1', name: 'Test Shelly',
      manufacturer_device_id: DEVICE,
    }) },
    $transaction: jest.fn((cb: (arg: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  const topics = { parseStatus: jest.fn().mockReturnValue({
    manufacturerDeviceId: DEVICE, kind: 'shelly-events',
  }) };
  const internal = new MqttDeviceStatusSubscriber(
    { config: { flespiDeviceId: DEVICE, switchId: 0 }, topics } as never,
    prisma as never, {} as never, { emitToUser } as never,
  ) as unknown as {
    handleStatusMessage(topic: string, payload: Buffer): Promise<void>;
    parsePayload(topic: string, payload: Buffer): unknown;
    findHomeRealtimeRecipients(tx: unknown, deviceId: string, homeId: string): Promise<{id_user:string}[]>;
  };
  jest.spyOn(internal, 'findHomeRealtimeRecipients').mockResolvedValue([{ id_user: 'user-1' }]);
  return { internal, tx, emitToUser };
}

describe('flespi 3D.3-A: timestamp ambiguo y contador reiniciado', () => {
  afterEach(() => jest.restoreAllMocks());


  it('rechaza un evento Shelly con reloj adelantado una hora antes de toda escritura', async () => {
    const c = setup();
    await c.internal.handleStatusMessage(
      TOPIC, frame(Date.now() / 1000 + 3600, true, 40, 7500),
    );
    expect(c.tx.$queryRaw).not.toHaveBeenCalled();
    expect(c.tx.device.update).not.toHaveBeenCalled();
    expect(c.tx.consumption.createMany).not.toHaveBeenCalled();
    expect(c.emitToUser).not.toHaveBeenCalled();
  });

  it('acepta una pequeña desviación positiva del reloj para conservar telemetría válida', async () => {
    const c = setup();
    await c.internal.handleStatusMessage(
      TOPIC, frame(Date.now() / 1000 + 60, true, 40, 7500),
    );
    expect(c.tx.device.update).toHaveBeenCalledTimes(1);
    expect(c.tx.consumption.createMany).toHaveBeenCalledTimes(1);
  });
  it('3D.3-B2: read_at anterior al ultimo persistido se eleva sin perder delta', async () => {
    const last = new Date(Date.now() + 15_000);
    const c = setup({ previousKwh: 1.0, latestReadAt: last });
    jest.spyOn(c.internal, 'parsePayload').mockReturnValue({
      connectivityStatus: 'ONLINE', isOn: true, currentPowerW: 25,
      energyTotalKwh: 1.5,
      readAt: new Date(Date.now() - 30_000).toISOString(),
    });
    await c.internal.handleStatusMessage(TOPIC, frame(1793388604.8, true, 25, 1500));
    expect(c.tx.consumption.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        energy_delta_kwh: 0.5, read_at: new Date(last.getTime() + 1),
      })],
    }));
    expect(c.emitToUser).toHaveBeenCalledWith(
      'user-1', 'consumption.created',
      expect.objectContaining({ readAt: new Date(last.getTime() + 1) }),
    );
  });

  it('3D.3-B2: consumo sin total tambien mantiene read_at posterior', async () => {
    const last = new Date(Date.now() + 15_000);
    const c = setup({ latestReadAt: last });
    jest.spyOn(c.internal, 'parsePayload').mockReturnValue({
      connectivityStatus: 'ONLINE', isOn: false, currentPowerW: 0,
      readAt: new Date(Date.now() - 30_000).toISOString(),
    });
    await c.internal.handleStatusMessage(TOPIC, frame(1793388604.8, false, 0, 0));
    expect(c.tx.consumption.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        energy_delta_kwh: 0, read_at: new Date(last.getTime() + 1),
      })],
    }));
  });

  it('reconoce hashes distintos pero rechaza el segundo frame con el mismo ts', async () => {
    const first = frame(1793388603.75, false, 10, 1800);
    const changed = frame(1793388603.75, true, 20, 1900);
    expect(identifyFlespiShellyEvent(TOPIC, first, 0)?.eventKey)
      .not.toEqual(identifyFlespiShellyEvent(TOPIC, changed, 0)?.eventKey);
    const c = setup({ watermark: 1793388603.75, previousKwh: 1.8 });
    await c.internal.handleStatusMessage(TOPIC, changed);
    expect(c.tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(c.tx.device.update).not.toHaveBeenCalled();
    expect(c.tx.consumption.createMany).not.toHaveBeenCalled();
    expect(c.emitToUser).not.toHaveBeenCalled();
  });

  it('reloj de origen retrocedido: rechaza estado y consumo', async () => {
    const c = setup({ watermark: 1793388603.75, previousKwh: 2 });
    await c.internal.handleStatusMessage(TOPIC, frame(1793380000, true, 50, 4000));
    expect(c.tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(c.tx.device.update).not.toHaveBeenCalled();
    expect(c.tx.consumption.createMany).not.toHaveBeenCalled();
    expect(c.emitToUser).not.toHaveBeenCalled();
  });

  it('contador reiniciado con nuevo ts: crea lectura con delta cero', async () => {
    const c = setup({ watermark: 1793388603.75, previousKwh: 2 });
    await c.internal.handleStatusMessage(TOPIC, frame(1793388603.9, true, 15, 100));
    expect(c.tx.device.update).toHaveBeenCalledTimes(1);
    expect(c.tx.consumption.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ energy_total_kwh: 0.1, energy_delta_kwh: 0 })],
    }));
    expect(c.emitToUser).toHaveBeenCalledWith('user-1', 'consumption.created', expect.anything());
  });

  it('incremento posterior al reset: contabiliza diferencia positiva', async () => {
    const c = setup({ watermark: 1793388603.9, previousKwh: 0.1 });
    await c.internal.handleStatusMessage(TOPIC, frame(1793388604.05, false, 9, 500));
    expect(c.tx.consumption.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ energy_total_kwh: 0.5, energy_delta_kwh: 0.4 })],
    }));
  });
});
