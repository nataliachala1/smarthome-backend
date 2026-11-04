import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { Pool } from 'pg';

import request from 'supertest';
import { App } from 'supertest/types';

import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';

import { PrismaRlsService } from '../src/infrastructure/database/prisma/prisma-rls.service';

import { PrismaDeviceRepository } from '../src/modules/devices/infrastructure/persistence/prisma-device.repository';

import { DeviceRepository } from '../src/modules/devices/domain/repositories/device.repository';

import { DeviceControlPublisher } from '../src/modules/devices/domain/services/device-control-publisher';

import { CreateDeviceUseCase } from '../src/modules/devices/application/use-cases/create-device.use-case';

import { ListHomeDevicesUseCase } from '../src/modules/devices/application/use-cases/list-home-devices.use-case';

import { ListInactiveDevicesUseCase } from '../src/modules/devices/application/use-cases/list-inactive-devices.use-case';

import { GetDeviceByIdUseCase } from '../src/modules/devices/application/use-cases/get-device-by-id.use-case';

import { UpdateDeviceUseCase } from '../src/modules/devices/application/use-cases/update-device.use-case';

import { DeactivateDeviceUseCase } from '../src/modules/devices/application/use-cases/deactivate-device.use-case';

import { ActivateDeviceUseCase } from '../src/modules/devices/application/use-cases/activate-device.use-case';

import { DeleteDeviceUseCase } from '../src/modules/devices/application/use-cases/delete-device.use-case';

import { ControlDeviceUseCase } from '../src/modules/devices/application/use-cases/control-device.use-case';

import { DevicesController } from '../src/modules/devices/presentation/controllers/devices.controller';

import { JwtAuthGuard } from '../src/modules/auth/presentation/http/guards/jwt-auth.guard';


const databaseUrl =
  process.env.SCOPE_TEST_DATABASE_URL;

const describeDatabase =
  databaseUrl
    ? describe
    : describe.skip;


interface TestRequest {
  headers: Record<string, string>;

  user: {
    userId: string;
  };
}


describeDatabase(
  'Direct home devices HTTP + Prisma + PostgreSQL RLS',
  () => {
    let app: INestApplication<App>;
    let admin: Pool;

    const home =
      '20000000-0000-4000-8000-000000000001';

    const user = (
      n: number,
    ) =>
      `10000000-0000-4000-8000-${String(
        n,
      ).padStart(12, '0')}`;

    const endpoint =
      `/api/v1/homes/${home}/devices`;


    beforeAll(
      async () => {
        const url =
          new URL(
            databaseUrl!,
          );

        if (
          url.pathname !==
          '/smarthome_scope_test'
        ) {
          throw new Error(
            'Use only the isolated scope test database',
          );
        }

        admin =
          new Pool({
            connectionString:
              databaseUrl,
          });

        /*
         * Ejecutamos Prisma con el rol funcional
         * para que PostgreSQL RLS participe
         * realmente en las pruebas.
         */
        url.searchParams.set(
          'options',
          '-c role=smarthome_app',
        );

        const module =
          await Test.createTestingModule({
            controllers: [
              DevicesController,
            ],

            providers: [
              {
                provide:
                  ConfigService,

                useValue:
                  new ConfigService({
                    DATABASE_URL:
                      url.toString(),
                  }),
              },

              PrismaService,
              PrismaRlsService,

              CreateDeviceUseCase,

              ListHomeDevicesUseCase,

              ListInactiveDevicesUseCase,

              GetDeviceByIdUseCase,

              UpdateDeviceUseCase,

              DeactivateDeviceUseCase,

              ActivateDeviceUseCase,

              DeleteDeviceUseCase,

              ControlDeviceUseCase,

              {
                provide:
                  DeviceControlPublisher,

                useValue: {
                  publishControlCommand:
                    jest
                      .fn()
                      .mockResolvedValue(
                        undefined,
                      ),
                },
              },

              {
                provide:
                  DeviceRepository,

                useClass:
                  PrismaDeviceRepository,
              },
            ],
          })
            .overrideGuard(
              JwtAuthGuard,
            )
            .useValue({
              /*
               * La autenticación se aísla.
               * La autorización real se valida
               * mediante NestJS + PostgreSQL RLS.
               */
              canActivate(
                context:
                  ExecutionContext,
              ) {
                const req =
                  context
                    .switchToHttp()
                    .getRequest<TestRequest>();

                req.user = {
                  userId:
                    req.headers[
                      'x-test-user'
                    ],
                };

                return true;
              },
            })
            .compile();

        app =
          module.createNestApplication();

        app.useGlobalPipes(
          new ValidationPipe({
            whitelist: true,

            forbidNonWhitelisted:
              true,

            transform: true,
          }),
        );

        await app.init();
      },
    );


    afterAll(
      async () => {
        if (admin) {
          await admin.query(
            `
            DELETE
            FROM devices.device
            WHERE name LIKE 'HTTP scope %'
            `,
          );

          await admin.end();
        }

        if (app) {
          await app.close();
        }
      },
    );


    it(
      'OWNER creates directly under the home and starts OFFLINE',
      async () => {
        const result =
          await request(
            app.getHttpServer(),
          )
            .post(endpoint)
            .set(
              'x-test-user',
              user(1),
            )
            .send({
              name:
                '  HTTP scope device  ',
            })
            .expect(201);

        expect(
          result.body,
        ).toMatchObject({
          homeId:
            home,

          name:
            'HTTP scope device',

          connectivityStatus:
            'OFFLINE',

          isOn:
            false,
        });

        /*
         * Campos retirados del modelo.
         */
        expect(
          result.body,
        ).not.toHaveProperty(
          'zoneId',
        );

        expect(
          result.body,
        ).not.toHaveProperty(
          'deviceTypeId',
        );
      },
    );


    it.each(
      [1, 2, 3],
    )(
      'active role user %i can list',
      async (
        n,
      ) => {
        const result =
          await request(
            app.getHttpServer(),
          )
            .get(endpoint)
            .set(
              'x-test-user',
              user(n),
            )
            .expect(200);

        expect(
          result.body,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              homeId:
                home,
            }),
          ]),
        );
      },
    );


    it.each(
      [2, 3, 4, 5],
    )(
      'user %i cannot create without OWNER membership',
      async (
        n,
      ) => {
        await request(
          app.getHttpServer(),
        )
          .post(endpoint)
          .set(
            'x-test-user',
            user(n),
          )
          .send({
            name:
              'HTTP scope forbidden',
          })
          .expect(403);
      },
    );


    it.each(
      [4, 5],
    )(
      'outside/pending user %i cannot list',
      async (
        n,
      ) => {
        await request(
          app.getHttpServer(),
        )
          .get(endpoint)
          .set(
            'x-test-user',
            user(n),
          )
          .expect(403);
      },
    );


    it(
      'duplicate active name returns 409',
      async () => {
        await request(
          app.getHttpServer(),
        )
          .post(endpoint)
          .set(
            'x-test-user',
            user(1),
          )
          .send({
            name:
              'HTTP scope device',
          })
          .expect(409);
      },
    );


    it(
      'rejects missing and whitespace-only names',
      async () => {
        await request(
          app.getHttpServer(),
        )
          .post(endpoint)
          .set(
            'x-test-user',
            user(1),
          )
          .send({})
          .expect(400);

        await request(
          app.getHttpServer(),
        )
          .post(endpoint)
          .set(
            'x-test-user',
            user(1),
          )
          .send({
            name:
              '   ',
          })
          .expect(400);
      },
    );


    it(
      'rejects invalid transport and messaging protocol values',
      async () => {
        await request(
          app.getHttpServer(),
        )
          .post(endpoint)
          .set(
            'x-test-user',
            user(1),
          )
          .send({
            name:
              'HTTP scope invalid transport',

            transportType:
              'ZIGBEE',
          })
          .expect(400);

        await request(
          app.getHttpServer(),
        )
          .post(endpoint)
          .set(
            'x-test-user',
            user(1),
          )
          .send({
            name:
              'HTTP scope invalid protocol',

            messagingProtocol:
              'HTTP',
          })
          .expect(400);
      },
    );


    it(
      'rejects retired zoneId field',
      async () => {
        await request(
          app.getHttpServer(),
        )
          .post(endpoint)
          .set(
            'x-test-user',
            user(1),
          )
          .send({
            name:
              'HTTP scope old zone',

            zoneId:
              home,
          })
          .expect(400);
      },
    );


    it(
      'rejects retired deviceTypeId field',
      async () => {
        await request(
          app.getHttpServer(),
        )
          .post(endpoint)
          .set(
            'x-test-user',
            user(1),
          )
          .send({
            name:
              'HTTP scope old device type',

            deviceTypeId:
              '90000000-0000-4000-8000-000000000001',
          })
          .expect(400);
      },
    );


    it(
      'rejects invalid home UUID',
      async () => {
        await request(
          app.getHttpServer(),
        )
          .get(
            '/api/v1/homes/invalid/devices',
          )
          .set(
            'x-test-user',
            user(1),
          )
          .expect(400);
      },
    );
  },
);