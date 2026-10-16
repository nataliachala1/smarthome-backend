import {
  BadRequestException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isIP } from 'node:net';
import { ShellyLocalAccessService } from './shelly-local-access.service';
import { ShellyRpcError, ShellyRpcErrorCode } from './shelly-rpc.error';

export interface ShellyDeviceInfo {
  id: string;
  mac: string;
  model: string;
  gen: number;
  fw_id?: string;
  ver?: string;
  app?: string;
  auth_en: boolean;
}

export interface ConfigureShellyMqttInput {
  server: string;
  topicPrefix: string;
  username?: string;
  password?: string;
}

export interface ShellyMqttStatus {
  connected: boolean | null;
  errorCode: ShellyRpcErrorCode | null;
}

@Injectable()
export class ShellyRpcClientService {
  private readonly timeoutMs = 3000;

  constructor(private readonly localAccess: ShellyLocalAccessService) {}

  async getDeviceInfo(ip: string): Promise<ShellyDeviceInfo> {
    this.assertTarget(ip);
    const response = await this.requestJson('http://' + ip + '/shelly', {
      method: 'GET',
    });
    if (!this.isShellyDeviceInfo(response)) {
      throw new UnprocessableEntityException({
        code: 'SHELLY_INVALID_DEVICE',
        message: 'La respuesta no identifica un dispositivo Shelly válido.',
      });
    }
    return response;
  }

  async getMqttStatus(ip: string): Promise<ShellyMqttStatus> {
    // Keep local-policy and input failures outside the optional probe catch.
    this.assertTarget(ip);
    try {
      const response = await this.requestJson(
        'http://' + ip + '/rpc/MQTT.GetStatus',
        { method: 'GET' },
      );
      if (!this.isRecord(response) || typeof response.connected !== 'boolean') {
        throw new ShellyRpcError('SHELLY_INVALID_RESPONSE');
      }
      return { connected: response.connected, errorCode: null };
    } catch (error) {
      if (!(error instanceof ShellyRpcError)) throw error;
      // Identification remains useful when MQTT status cannot be obtained.
      return { connected: null, errorCode: error.code };
    }
  }

  async configureMqtt(
    ip: string,
    input: ConfigureShellyMqttInput,
  ): Promise<{ restartRequired: boolean }> {
    this.assertTarget(ip);
    const config: Record<string, unknown> = {
      enable: true,
      server: input.server,
      // Shelly documents null as plain TCP. Pin the built-in CA bundle so
      // provisioning never silently downgrades the broker connection.
      ssl_ca: 'ca.pem',
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
    const response = await this.postRpc(ip, 'MQTT.SetConfig', { config });
    if (
      !this.isRecord(response) ||
      typeof response.restart_required !== 'boolean'
    ) {
      throw new ShellyRpcError('SHELLY_INVALID_RESPONSE');
    }
    return { restartRequired: response.restart_required };
  }

  async reboot(ip: string): Promise<void> {
    this.assertTarget(ip);
    // Shelly.Reboot documents JSON null. Preserve the previous empty-body
    // compatibility only for this method, never for MQTT.SetConfig.
    const response = await this.postRpc(ip, 'Shelly.Reboot', {}, true);
    if (response !== null) throw new ShellyRpcError('SHELLY_INVALID_RESPONSE');
  }

  async waitForMqttConnection(
    ip: string,
    attempts = 12,
    delayMs = 1500,
  ): Promise<boolean> {
    this.assertTarget(ip);
    await this.sleep(2000);
    let lastStatus: ShellyMqttStatus = { connected: false, errorCode: null };
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      lastStatus = await this.getMqttStatus(ip);
      if (lastStatus.connected === true) return true;
      if (attempt < attempts) await this.sleep(delayMs);
    }
    if (lastStatus.errorCode) throw new ShellyRpcError(lastStatus.errorCode);
    return false;
  }

  private postRpc(
    ip: string,
    method: string,
    params: Record<string, unknown>,
    allowEmpty = false,
  ): Promise<unknown> {
    return this.requestJson(
      'http://' + ip + '/rpc/' + method,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      },
      allowEmpty,
    );
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    allowEmpty = false,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        headers: { Accept: 'application/json', ...init.headers },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ShellyRpcError(
          response.status === 401 || response.status === 403
            ? 'SHELLY_AUTH_REQUIRED'
            : 'SHELLY_HTTP_ERROR',
        );
      }
      const body = await response.text();
      if (allowEmpty && body.trim() === '') return null;
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        throw new ShellyRpcError('SHELLY_INVALID_RESPONSE');
      }
      // Method-specific HTTP endpoints return direct results, not /rpc envelopes.
      if (
        this.isRecord(value) &&
        ('error' in value || ('code' in value && 'message' in value))
      ) {
        throw new ShellyRpcError('SHELLY_RPC_ERROR');
      }
      return value;
    } catch (error) {
      if (error instanceof ShellyRpcError) throw error;
      throw new ShellyRpcError(
        controller.signal.aborted ? 'SHELLY_RPC_TIMEOUT' : 'SHELLY_UNREACHABLE',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertTarget(ip: string): void {
    this.localAccess.assertEnabled();
    const [first, second] = ip.split('.').map(Number);
    if (
      isIP(ip) !== 4 ||
      !(
        first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
      )
    ) {
      throw new BadRequestException({
        code: 'SHELLY_INVALID_IP',
        message: 'La IP del Shelly debe ser una IPv4 privada local.',
      });
    }
  }

  private isShellyDeviceInfo(value: unknown): value is ShellyDeviceInfo {
    if (!this.isRecord(value)) return false;
    return (
      ['id', 'mac', 'model'].every(
        (key) => typeof value[key] === 'string' && value[key].trim().length > 0,
      ) &&
      typeof value.gen === 'number' &&
      Number.isSafeInteger(value.gen) &&
      value.gen > 0 &&
      typeof value.auth_en === 'boolean' &&
      ['fw_id', 'ver', 'app'].every(
        (key) => value[key] === undefined || typeof value[key] === 'string',
      )
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private async sleep(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}
