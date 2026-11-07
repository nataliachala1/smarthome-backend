/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers such as expect.any() are typed as any. */
jest.mock('../../../../infrastructure/database/prisma/prisma-rls.service', () => ({
  PrismaRlsService: class PrismaRlsService {},
}));
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { GetDeviceConsumptionSummaryUseCase } from './get-device-consumption-summary.use-case';
import { GetHomeConsumptionSummaryUseCase } from './get-home-consumption-summary.use-case';
import { ListDeviceConsumptionUseCase } from './list-device-consumption.use-case';
import { ListHomeConsumptionUseCase } from './list-home-consumption.use-case';

const aggregate = {
  _count: { _all: 3 },
  _sum: { energy_delta_kwh: '1.250000' },
  _avg: { power_w: '20.5' },
  _max: { power_w: '40' },
  _min: { power_w: '1' },
};
const row = {
  id_consumption: 'c1',
  id_home: 'h1',
  id_device: 'd1',
  power_w: '12.5',
  energy_delta_kwh: '0.010000',
  energy_total_kwh: null,
  voltage_v: '120.1',
  current_a: null,
  frequency_hz: '60',
  temperature_c: null,
  read_at: new Date('2026-11-01T12:00:00Z'),
};

/** Fake Prisma transaction: $queryRaw answers come from `raw` in call order. */
function rls(raw: unknown[][], data: { aggregate?: unknown; latest?: unknown; rows?: unknown[] } = {}) {
  const tx = {
    $queryRaw: jest.fn(),
    consumption: {
      aggregate: jest.fn().mockResolvedValue(data.aggregate ?? aggregate),
      findFirst: jest.fn().mockResolvedValue('latest' in data ? data.latest : { read_at: row.read_at, energy_total_kwh: '9.5' }),
      findMany: jest.fn().mockResolvedValue(data.rows ?? [row]),
    },
  };
  raw.forEach((value) => tx.$queryRaw.mockResolvedValueOnce(value));
  const prismaRls = { withUserContext: jest.fn((_id: string, op: (t: typeof tx) => unknown) => op(tx)) };
  return { prismaRls, tx };
}

const homeInput = { userId: 'u1', homeId: 'h1', from: '2026-11-01T00:00:00Z', to: '2026-11-30T00:00:00Z' };
const deviceInput = { ...homeInput, deviceId: 'd1' };
const allowed = [{ allowed: true }];
const denied = [{ allowed: false }];
const historyDevice = [{ id_device: 'd1', name: 'Lámpara', manufacturer_device_id: 'shelly-1' }];

describe('Consumption use cases', () => {
  describe.each([
    ['GetHomeConsumptionSummaryUseCase', GetHomeConsumptionSummaryUseCase],
    ['ListHomeConsumptionUseCase', ListHomeConsumptionUseCase],
    ['GetDeviceConsumptionSummaryUseCase', GetDeviceConsumptionSummaryUseCase],
    ['ListDeviceConsumptionUseCase', ListDeviceConsumptionUseCase],
  ])('%s', (_name, Ctor) => {
    it('rejects a reversed date range before touching the database', async () => {
      const { prismaRls } = rls([]);
      await expect(
        new Ctor(prismaRls as never).execute({ ...deviceInput, from: '2026-12-01', to: '2026-11-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaRls.withUserContext).not.toHaveBeenCalled();
    });
  });

  describe('GetHomeConsumptionSummaryUseCase', () => {
    it('returns full statistics to an OWNER or authorized MEMBER', async () => {
      const { prismaRls, tx } = rls([allowed]);
      const result = await new GetHomeConsumptionSummaryUseCase(prismaRls as never).execute(homeInput);

      expect(prismaRls.withUserContext).toHaveBeenCalledWith('u1', expect.any(Function));
      expect(result).toMatchObject({
        homeId: 'h1',
        readingsCount: 3,
        devicesWithReadings: 1,
        totalEnergyDeltaKwh: 1.25,
        averagePowerW: 20.5,
        maxPowerW: 40,
        minPowerW: 1,
        latestReadAt: row.read_at,
      });
      expect(tx.consumption.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id_home: 'h1', read_at: expect.any(Object) }) }),
      );
    });

    it('returns null statistics when there are no readings', async () => {
      const empty = { _count: { _all: 0 }, _sum: { energy_delta_kwh: null }, _avg: { power_w: null }, _max: { power_w: null }, _min: { power_w: null } };
      const { prismaRls } = rls([allowed], { aggregate: empty, latest: null, rows: [] });
      const result = await new GetHomeConsumptionSummaryUseCase(prismaRls as never).execute({ userId: 'u1', homeId: 'h1' });
      expect(result).toMatchObject({ readingsCount: 0, totalEnergyDeltaKwh: 0, averagePowerW: null, latestReadAt: null, from: null, to: null });
    });

    it('gives a GUEST only the basic energy total', async () => {
      const { prismaRls, tx } = rls([denied, [{ total_energy_delta_kwh: '0.5' }]]);
      await expect(new GetHomeConsumptionSummaryUseCase(prismaRls as never).execute(homeInput)).resolves.toEqual({
        homeId: 'h1',
        from: new Date(homeInput.from),
        to: new Date(homeInput.to),
        totalEnergyDeltaKwh: 0.5,
      });
      expect(tx.consumption.aggregate).not.toHaveBeenCalled();
    });

    it('answers 403 to someone without any membership', async () => {
      const { prismaRls } = rls([denied, []]);
      await expect(new GetHomeConsumptionSummaryUseCase(prismaRls as never).execute(homeInput)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('ListHomeConsumptionUseCase', () => {
    it('maps readings with device metadata and numeric values', async () => {
      const { prismaRls, tx } = rls([allowed, historyDevice]);
      const result = await new ListHomeConsumptionUseCase(prismaRls as never).execute({ ...homeInput, limit: 10 });
      expect(result).toEqual([
        {
          id: 'c1',
          homeId: 'h1',
          deviceId: 'd1',
          deviceName: 'Lámpara',
          manufacturerDeviceId: 'shelly-1',
          powerW: 12.5,
          energyDeltaKwh: 0.01,
          energyTotalKwh: null,
          voltageV: 120.1,
          currentA: null,
          frequencyHz: 60,
          temperatureC: null,
          readAt: row.read_at,
        },
      ]);
      expect(tx.consumption.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
    });

    it('answers 403 without the consumption detail permission', async () => {
      const { prismaRls, tx } = rls([denied]);
      await expect(new ListHomeConsumptionUseCase(prismaRls as never).execute(homeInput)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(tx.consumption.findMany).not.toHaveBeenCalled();
    });
  });

  describe('device consumption', () => {
    it('summarizes one device after checking permission and ownership', async () => {
      const { prismaRls } = rls([allowed, historyDevice]);
      const result = await new GetDeviceConsumptionSummaryUseCase(prismaRls as never).execute(deviceInput);
      expect(result).toMatchObject({ homeId: 'h1', deviceId: 'd1', readingsCount: 3, totalEnergyDeltaKwh: 1.25 });
    });

    it('lists the readings of one device', async () => {
      const { prismaRls } = rls([allowed, historyDevice]);
      const result = await new ListDeviceConsumptionUseCase(prismaRls as never).execute(deviceInput);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ deviceId: 'd1', powerW: 12.5 });
    });

    it('answers 404 for a device outside the home', async () => {
      const { prismaRls } = rls([allowed, []]);
      await expect(new GetDeviceConsumptionSummaryUseCase(prismaRls as never).execute(deviceInput)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('answers 403 without the device detail permission', async () => {
      const { prismaRls } = rls([denied]);
      await expect(new ListDeviceConsumptionUseCase(prismaRls as never).execute(deviceInput)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
