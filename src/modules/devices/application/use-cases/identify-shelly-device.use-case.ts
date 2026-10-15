import {
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import { PrismaRlsService } from '../../../../infrastructure/database/prisma/prisma-rls.service';

import { ShellyRpcClientService } from '../../infrastructure/shelly/shelly-rpc-client.service';

@Injectable()
export class IdentifyShellyDeviceUseCase {
  constructor(
    private readonly prismaRls: PrismaRlsService,
    private readonly shellyRpcClient: ShellyRpcClientService,
  ) {}

  async execute(
    userId: string,
    homeId: string,
    shellyIp: string,
  ) {
    await this.assertCanManageHome(userId, homeId);

    const deviceInfo =
      await this.shellyRpcClient.getDeviceInfo(shellyIp);

    this.assertSupportedDevice(deviceInfo);

    const authenticationRequired =
      deviceInfo.auth_en === true;

    const mqttConnected = authenticationRequired
      ? null
      : await this.shellyRpcClient.getMqttConnected(
          shellyIp,
        );

    return {
      manufacturerDeviceId: deviceInfo.id,
      model: 'Shelly 1PM Gen4',
      modelCode: deviceInfo.model,
      mac: deviceInfo.mac,
      wifiIp: shellyIp,
      firmwareVersion: deviceInfo.ver ?? null,
      mqttConnected,
      authenticationRequired,
      message: 'Shelly detectado correctamente',
    };
  }

  private async assertCanManageHome(
    userId: string,
    homeId: string,
  ): Promise<void> {
    await this.prismaRls.withUserContext(
      userId,
      async (tx) => {
        const [access] = await tx.$queryRaw<
          { allowed: boolean }[]
        >`
          SELECT homes.fn_can_manage_home(
            ${homeId}::uuid
          ) AS allowed
        `;

        if (!access?.allowed) {
          throw new ForbiddenException(
            'Solo el propietario del hogar puede vincular dispositivos Shelly',
          );
        }
      },
    );
  }

  private assertSupportedDevice(deviceInfo: {
    model: string;
    gen: number;
  }): void {
    const isShelly1PmGen4 =
      deviceInfo.model === 'S4SW-001P16EU' &&
      deviceInfo.gen === 4;

    if (!isShelly1PmGen4) {
      throw new UnprocessableEntityException(
        'El dispositivo detectado no es un Shelly 1PM Gen4 compatible',
      );
    }
  }
}