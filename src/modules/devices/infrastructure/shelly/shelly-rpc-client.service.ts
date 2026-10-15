import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import { isIP } from 'node:net';

export interface ShellyDeviceInfo {
  id: string;
  mac: string;
  model: string;
  gen: number;
  fw_id?: string;
  ver?: string;
  app?: string;
  auth_en?: boolean;
}

export interface ConfigureShellyMqttInput {
  server: string;
  topicPrefix: string;
  username?: string;
  password?: string;
}

interface ShellySetConfigResult {
  restart_required?: boolean;
}

interface ShellyMqttStatus {
  connected?: boolean;
}

@Injectable()
export class ShellyRpcClientService {
  private readonly timeoutMs = 3000;

  async getDeviceInfo(ip: string): Promise<ShellyDeviceInfo> {
    this.assertPrivateIpv4(ip);

    const response = await this.getJson<unknown>(
      `http://${ip}/shelly`,
    );

    if (!this.isShellyDeviceInfo(response)) {
      throw new UnprocessableEntityException(
        'La IP indicada no corresponde a un dispositivo Shelly válido',
      );
    }

    return response;
  }

  async getMqttConnected(ip: string): Promise<boolean | null> {
    this.assertPrivateIpv4(ip);

    try {
      const response = await this.getJson<unknown>(
        `http://${ip}/rpc/MQTT.GetStatus`,
      );

      if (
        !this.isObjectRecord(response) ||
        typeof response.connected !== 'boolean'
      ) {
        return null;
      }

      return response.connected;
    } catch {
      /*
       * La identificación del dispositivo ya fue exitosa.
       * MQTT.GetStatus puede requerir autenticación si el usuario
       * protegió el Shelly, por lo que no hacemos fallar todo
       * el endpoint identify.
       */
      return null;
    }
  }

  async configureMqtt(
    ip: string,
    input: ConfigureShellyMqttInput,
  ): Promise<{ restartRequired: boolean }> {
    this.assertPrivateIpv4(ip);

    const config: Record<string, unknown> = {
      enable: true,
      server: input.server,
      topic_prefix: input.topicPrefix,
      rpc_ntf: true,
      status_ntf: true,
      enable_rpc: true,
      enable_control: true,
    };

    if (input.username) {
      config.user = input.username;
      config.pass = input.password;
    }

    const result = await this.postRpc<ShellySetConfigResult>(ip, 'MQTT.SetConfig', {
      config,
    });

    return {
      restartRequired: result.restart_required === true,
    };
  }

  async reboot(ip: string): Promise<void> {
    this.assertPrivateIpv4(ip);

    await this.postRpc<null>(ip, 'Shelly.Reboot', {});
  }

  async waitForMqttConnection(
    ip: string,
    attempts = 12,
    delayMs = 1500,
  ): Promise<boolean> {
    /*
     * MQTT.SetConfig normalmente requiere reinicio.
     * Esperamos primero a que el Shelly vuelva a estar
     * disponible.
     */
    await this.sleep(2000);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const connected = await this.getMqttConnected(ip);

      if (connected === true) {
        return true;
      }

      if (attempt < attempts) {
        await this.sleep(delayMs);
      }
    }

    return false;
  }

  private async getJson<T>(url: string): Promise<T> {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        redirect: 'error',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new BadGatewayException(
          `El Shelly respondió con HTTP ${response.status}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException(
        'El Shelly no responde o no es accesible desde el backend',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertPrivateIpv4(ip: string): void {
    if (isIP(ip) !== 4) {
      throw new BadRequestException(
        'La dirección IP del Shelly no es una IPv4 válida',
      );
    }

    const octets = ip.split('.').map(Number);

    const first = octets[0];
    const second = octets[1];

    const isPrivate =
      first === 10 ||
      (first === 172 &&
        second !== undefined &&
        second >= 16 &&
        second <= 31) ||
      (first === 192 && second === 168);

    if (!isPrivate) {
      throw new BadRequestException(
        'La IP del Shelly debe pertenecer a una red privada local',
      );
    }
  }

  private isShellyDeviceInfo(
    value: unknown,
  ): value is ShellyDeviceInfo {
    if (!this.isObjectRecord(value)) {
      return false;
    }

    return (
      typeof value.id === 'string' &&
      value.id.length > 0 &&
      typeof value.mac === 'string' &&
      value.mac.length > 0 &&
      typeof value.model === 'string' &&
      value.model.length > 0 &&
      typeof value.gen === 'number'
    );
  }

  private isObjectRecord(
    value: unknown,
  ): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  private async postRpc<T>(
    ip: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await fetch(`http://${ip}/rpc/${method}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
        redirect: 'error',
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new BadGatewayException(
          `El Shelly respondió con HTTP ${response.status} al ejecutar ${method}`,
        );
      }

      const body = await response.text();

      if (!body || body.trim() === 'null') {
        return null as T;
      }

      try {
        return JSON.parse(body) as T;
      } catch {
        throw new BadGatewayException(
          `El Shelly devolvió una respuesta inválida al ejecutar ${method}`,
        );
      }
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException(
        `No fue posible ejecutar ${method} en el Shelly`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async sleep(
    milliseconds: number,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}