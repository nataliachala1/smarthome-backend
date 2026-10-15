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
     * 1. Buscar candidatos mediante mDNS.
     */
    const candidates =
      await this.discoveryService.discover();

    /*
     * 2. No confiamos únicamente en el anuncio mDNS.
     * Consultamos /shelly para verificar que realmente
     * sea un Shelly compatible.
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
               * Un dispositivo puede desaparecer durante
               * los segundos que dura el descubrimiento.
               * No hacemos fallar toda la búsqueda por un
               * candidato individual.
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
     * Eliminamos duplicados por ID del fabricante.
     * Algunos equipos pueden anunciar más de una IP.
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