import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';
import type { IClientOptions } from 'mqtt';
import {
  MQTT_SETTINGS,
  parseMqttConfig,
  MqttConfiguration,
} from '../../../../config/mqtt-config';
import { MqttTopicContract } from './mqtt-topic-contract';

@Injectable()
export class MqttRuntimeService {
  readonly config: MqttConfiguration;
  readonly topics: MqttTopicContract;
  private readonly controlClientId: string;
  private readonly statusClientId: string;
  private readonly ca?: Buffer;

  constructor(configService: ConfigService) {
    this.config = parseMqttConfig(
      Object.fromEntries(
        MQTT_SETTINGS.map((key) => [key, configService.get<unknown>(key)]),
      ),
    );
    this.topics = new MqttTopicContract(this.config);
    this.controlClientId =
      this.config.controlClientId ?? `smarthome-control-${randomUUID()}`;
    this.statusClientId =
      this.config.statusClientId ?? `smarthome-status-${randomUUID()}`;
    if (this.config.caFile) {
      try {
        this.ca = readFileSync(this.config.caFile);
        const pem = this.ca.toString('utf8');
        const certificates = pem.match(
          /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
        );
        if (!certificates?.length) throw new Error();
        for (const certificate of certificates)
          new X509Certificate(certificate);
        if (
          pem
            .replace(
              /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
              '',
            )
            .trim()
        )
          throw new Error();
        createSecureContext({ ca: this.ca, minVersion: 'TLSv1.2' });
      } catch {
        throw new Error(
          'MQTT_TLS_CA_FILE no contiene certificados PEM legibles y válidos.',
        );
      }
    }
  }

  clientOptions(role: 'control' | 'status'): IClientOptions {
    return {
      clientId: role === 'control' ? this.controlClientId : this.statusClientId,
      username: this.config.username,
      password: this.config.password,
      clean: true,
      reconnectPeriod: 1000,
      connectTimeout: 5000,
      ...(this.config.tls
        ? {
            rejectUnauthorized: true,
            minVersion: 'TLSv1.2',
            ...(this.ca ? { ca: this.ca } : {}),
          }
        : {}),
    };
  }
}
