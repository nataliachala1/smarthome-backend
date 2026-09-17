import {
  Injectable,
  Logger,
} from '@nestjs/common';

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
    new Logger(ShellyDiscoveryService.name);

  async discover(
    timeoutMs = 4000,
  ): Promise<ShellyMdnsCandidate[]> {
    const devices =
      new Map<string, ShellyMdnsCandidate>();

    const bonjour = new Bonjour(
      {},
      (error: Error) => {
        this.logger.warn(
          `Error mDNS durante descubrimiento Shelly: ${error.message}`,
        );
      },
    );

    const browser = bonjour.find(
      {
        type: 'shelly',
        protocol: 'tcp',
      },
      (service) => {
        const addresses =
          service.addresses ?? [];

        for (const address of addresses) {
          if (isIP(address) !== 4) {
            continue;
          }

          const key = `${address}:${service.port}`;

          devices.set(key, {
            ip: address,
            hostname: service.host,
            port: service.port,
            serviceName: service.name,
          });
        }
      },
    );

    await new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });

    browser.stop();

    await new Promise<void>((resolve) => {
      bonjour.destroy(() => resolve());
    });

    return Array.from(devices.values());
  }
}