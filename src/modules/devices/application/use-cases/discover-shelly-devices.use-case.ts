import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

import { DiscoveredShellyDeviceDto } from '../dto/discovered-shelly-device.dto';

import { ShellyDiscoveryService } from '../../infrastructure/shelly/shelly-discovery.service';

import { ShellyRpcClientService } from '../../infrastructure/shelly/shelly-rpc-client.service';

@Injectable()
export class DiscoverShellyDevicesUseCase {
  constructor(
    private readonly prismaRls:
      PrismaRlsService,

    private readonly discoveryService:
      ShellyDiscoveryService,

    private readonly shellyRpcClient:
      ShellyRpcClientService,
  ) {}

  async execute(
    userId: string,
    homeId: string,
  ): Promise<DiscoveredShellyDeviceDto[]> {
    await this.assertCanManageHome(
      userId,
      homeId,
    );

    /*
     * 1. Find candidates through mDNS.
     */
    const candidates =
      await this.discoveryService.discover();

    /*
     * 2. The mDNS announcement alone is not trusted.
     * /shelly is queried to verify that it really
     * is a compatible Shelly.
     */
    const inspected =
      await Promise.all(
        candidates.map(
          async (
            candidate,
          ): Promise<
            DiscoveredShellyDeviceDto | null
          > => {
            try {
              const info =
                await this.shellyRpcClient.getDeviceInfo(
                  candidate.ip,
                );

              const supported =
                info.model ===
                  'S4SW-001P16EU' &&
                info.gen === 4;

              if (!supported) {
                return null;
              }

              return {
                ip: candidate.ip,

                hostname:
                  candidate.hostname,

                port: candidate.port,

                manufacturerDeviceId:
                  info.id,

                mac: info.mac,

                model:
                  'Shelly 1PM Gen4',

                modelCode:
                  info.model,

                generation:
                  info.gen,

                firmwareVersion:
                  info.ver ?? null,
              };
            } catch {
              /*
               * A device can disappear during
               * the seconds the discovery takes.
               * The whole search does not fail because of a
               * single candidate.
               */
              return null;
            }
          },
        ),
      );

    const devices =
      inspected.filter(
        (
          device,
        ): device is DiscoveredShellyDeviceDto =>
          device !== null,
      );

    /*
     * Duplicates are removed by manufacturer ID.
     * Some devices may announce more than one IP.
     */
    const unique =
      new Map<
        string,
        DiscoveredShellyDeviceDto
      >();

    for (const device of devices) {
      unique.set(
        device.manufacturerDeviceId,
        device,
      );
    }

    return Array.from(
      unique.values(),
    );
  }

  private async assertCanManageHome(
    userId: string,
    homeId: string,
  ): Promise<void> {
    await this.prismaRls.withUserContext(
      userId,
      async (tx) => {
        const [access] =
          await tx.$queryRaw<
            { allowed: boolean }[]
          >`
            SELECT homes.fn_can_manage_home(
              ${homeId}::uuid
            ) AS allowed
          `;

        if (!access?.allowed) {
          throw new ForbiddenException(
            'Solo el propietario del hogar puede buscar dispositivos Shelly',
          );
        }
      },
    );
  }
}