jest.mock('./mqtt-runtime.service', () => ({
  MqttRuntimeService: class {},
}));

jest.mock('../../../../infrastructure/database/prisma/prisma-iot.service', () => ({
  PrismaIotService: class {},
}));

jest.mock('../../../../infrastructure/database/prisma/prisma-rls.service', () => ({
  PrismaRlsService: class {},
}));

jest.mock('../../../realtime/realtime-events.service', () => ({
  RealtimeEventsService: class {},
}));
import { Logger } from '@nestjs/common';
import { MqttDeviceStatusSubscriber } from './mqtt-device-status.subscriber';

describe('MQTT - persistencia independiente del estado', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function setup(consumptionFailure: boolean) {
    const emitToUser = jest.fn();

    const tx = {
      consumption: {
        findFirst: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    let transactions = 0;

    const prisma = {
      device: {
        findFirst: jest.fn().mockResolvedValue({
          id_device: 'device-1',
          id_home: 'home-1',
          name: 'Luz',
          manufacturer_device_id: 'shelly1pmg4-test',
        }),
        update: jest.fn().mockResolvedValue({
          id_device: 'device-1',
          id_home: 'home-1',
          connectivity_status: 'ONLINE',
          is_on: true,
          current_power_w: 35,
          updated_at: new Date('2026-10-28T10:00:00Z'),
        }),
      },
      $transaction: jest.fn(async (callback: any) => {
        transactions++;

        if (transactions === 2 && consumptionFailure) {
          throw new Error('SIMULATED_CONSUMPTION_FAILURE');
        }

        return callback(tx);
      }),
    };

    const subscriber = new MqttDeviceStatusSubscriber(
      {} as never,
      prisma as never,
      {} as never,
      { emitToUser } as never,
    );

    const internal = subscriber as any;

    jest
      .spyOn(internal, 'extractManufacturerDeviceId')
      .mockReturnValue('shelly1pmg4-test');

    jest.spyOn(internal, 'parsePayload').mockReturnValue({
      connectivityStatus: 'ONLINE',
      isOn: true,
      currentPowerW: 35,
      energyTotalKwh: 1.5,
      readAt: '2026-10-28T10:00:00Z',
    });

    jest
      .spyOn(internal, 'findHomeRealtimeRecipients')
      .mockResolvedValue([{ id_user: 'user-1' }]);

    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    return { internal, prisma, tx, emitToUser };
  }

  it('mantiene ONLINE aunque falle el consumo', async () => {
    const ctx = setup(true);

    await ctx.internal.handleStatusMessage(
      'test/status',
      Buffer.from('{}'),
    );

    expect(ctx.prisma.device.update).toHaveBeenCalledTimes(1);

    expect(ctx.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'device.status.updated',
      expect.objectContaining({
        connectivityStatus: 'ONLINE',
        isOn: true,
        currentPowerW: 35,
      }),
    );

    expect(ctx.emitToUser).not.toHaveBeenCalledWith(
      'user-1',
      'consumption.created',
      expect.anything(),
    );
  });

  it('publica estado y consumo cuando la ingesta funciona', async () => {
    const ctx = setup(false);

    await ctx.internal.handleStatusMessage(
      'test/status',
      Buffer.from('{}'),
    );

    expect(ctx.tx.consumption.createMany).toHaveBeenCalledTimes(1);

    expect(ctx.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'device.status.updated',
      expect.objectContaining({
        connectivityStatus: 'ONLINE',
        currentPowerW: 35,
      }),
    );

    expect(ctx.emitToUser).toHaveBeenCalledWith(
      'user-1',
      'consumption.created',
      expect.objectContaining({
        deviceId: 'device-1',
        powerW: 35,
        energyTotalKwh: 1.5,
      }),
    );
  });
});