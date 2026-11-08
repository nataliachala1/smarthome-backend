jest.mock('../../../../infrastructure/database/prisma/prisma-iot.service', () => ({ PrismaIotService: class PrismaIotService {} }));
jest.mock('../../../realtime/realtime-events.service', () => ({ RealtimeEventsService: class RealtimeEventsService {} }));

import { Logger } from '@nestjs/common';

import { DeviceOfflineWatcherService } from './device-offline-watcher.service';

const updatedAt = new Date('2026-11-07T12:00:00Z');

function setup(stale: unknown[] = [{ id_device: 'd1', id_home: 'h1', manufacturer_device_id: 'shelly-1', last_seen_at: null }]) {
  const prisma = {
    device: {
      findMany: jest.fn().mockResolvedValue(stale),
      update: jest.fn().mockResolvedValue({
        id_device: 'd1',
        id_home: 'h1',
        connectivity_status: 'OFFLINE',
        is_on: false,
        current_power_w: '0',
        updated_at: updatedAt,
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id_user: 'u1' }, { id_user: 'u2' }]),
  };
  const realtime = { emitToUser: jest.fn() };
  const service = new DeviceOfflineWatcherService(prisma as never, realtime as never);
  return { service, prisma, realtime };
}

describe('DeviceOfflineWatcherService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('marks stale ONLINE devices OFFLINE and notifies every home member', async () => {
    const { service, prisma, realtime } = setup();
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);

    const [query] = prisma.device.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(query.where).toMatchObject({ status: 'ACTIVE', deleted_at: null, connectivity_status: 'ONLINE' });
    expect(prisma.device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_device: 'd1' },
        data: { connectivity_status: 'OFFLINE', is_on: false, current_power_w: 0 },
      }),
    );
    const event = { id: 'd1', homeId: 'h1', connectivityStatus: 'OFFLINE', isOn: false, currentPowerW: 0, updatedAt };
    expect(realtime.emitToUser).toHaveBeenCalledWith('u1', 'device.status.updated', event);
    expect(realtime.emitToUser).toHaveBeenCalledWith('u2', 'device.status.updated', event);

    service.onModuleDestroy();
  });

  it('runs again on every interval and stops when the module is destroyed', async () => {
    const { service, prisma } = setup([]);
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(prisma.device.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.device.update).not.toHaveBeenCalled();

    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(prisma.device.findMany).toHaveBeenCalledTimes(2);
  });
});
