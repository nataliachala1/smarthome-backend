import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../infrastructure/database/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../infrastructure/database/prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let queryRaw: jest.Mock;

  beforeEach(async () => {
    queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: { $queryRaw: queryRaw },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports liveness without checking the database', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('reports readiness after successfully checking the database', async () => {
    await expect(controller.ready()).resolves.toEqual({
      status: 'ok',
      database: 'connected',
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing health response', async () => {
    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      database: 'connected',
    });
  });

  it('fails readiness when the database check fails', async () => {
    const error = new Error('database unavailable');
    queryRaw.mockRejectedValueOnce(error);

    await expect(controller.ready()).rejects.toBe(error);
  });
});
