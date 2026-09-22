import {
  Injectable,
  Logger,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import Bonjour from 'bonjour-service';

import { isIP } from 'node:net';

export interface ShellyMdnsCandidate {
  ip: string;
  hostname: string;
  port: number;
  serviceName: string;
}

@Injectable()
export class ShellyDiscoveryService {
  private readonly logger =
    new Logger(
      ShellyDiscoveryService.name,
    );

  constructor(
    private readonly configService:
      ConfigService,
  ) {}

  async discover(
    timeoutMs = 10000,
  ): Promise<
    ShellyMdnsCandidate[]
  > {
    const devices =
      new Map<
        string,
        ShellyMdnsCandidate
      >();

    const discoveryInterface =
      this.configService
        .get<string>(
          'SHELLY_DISCOVERY_INTERFACE',
        )
        ?.trim();

    this.logger.log(
      discoveryInterface
        ? `Buscando Shelly por mDNS usando interfaz ${discoveryInterface}`
        : 'Buscando Shelly por mDNS usando interfaz automática',
    );

    /*
     * bonjour-service utiliza multicast-dns.
     *
     * La librería soporta "interface" en ejecución,
     * pero sus tipos TypeScript no la declaran.
     */
    const bonjourOptions =
      (
        discoveryInterface
          ? {
              interface:
                discoveryInterface,
            }
          : {}
      ) as ConstructorParameters<
        typeof Bonjour
      >[0];

    const bonjour =
      new Bonjour(
        bonjourOptions,
        (error: Error) => {
          this.logger.warn(
            `Error mDNS durante descubrimiento Shelly: ${error.message}`,
          );
        },
      );

    const browser =
      bonjour.find(
        {
          type: 'shelly',
          protocol: 'tcp',
        },
        (service) => {
          this.logger.log(
            `Respuesta mDNS recibida: ${service.name}`,
          );

          const addresses =
            service.addresses ??
            [];

          for (
            const address
            of addresses
          ) {
            if (
              isIP(address) !==
              4
            ) {
              continue;
            }

            const key =
              `${address}:${service.port}`;

            if (
              devices.has(
                key,
              )
            ) {
              continue;
            }

            devices.set(
              key,
              {
                ip:
                  address,

                hostname:
                  service.host,

                port:
                  service.port,

                serviceName:
                  service.name,
              },
            );

            this.logger.log(
              `Shelly descubierto: ${service.name} - ${address}:${service.port}`,
            );
          }
        },
      );

    /*
     * En algunas redes Wi-Fi la primera consulta
     * multicast puede perderse.
     *
     * Reintentamos mientras la ventana de
     * descubrimiento permanece abierta.
     */
    const updateInterval =
      setInterval(
        () => {
          this.logger.debug(
            'Reenviando consulta mDNS Shelly...',
          );

          browser.update();
        },
        1500,
      );

    try {
      await new Promise<void>(
        (resolve) => {
          setTimeout(
            resolve,
            timeoutMs,
          );
        },
      );
    } finally {
      clearInterval(
        updateInterval,
      );

      browser.stop();

      await new Promise<void>(
        (resolve) => {
          bonjour.destroy(
            () => resolve(),
          );
        },
      );
    }

    const result =
      Array.from(
        devices.values(),
      );

    this.logger.log(
      `Descubrimiento Shelly finalizado: ${result.length} candidato(s) encontrado(s)`,
    );

    return result;
  }
}