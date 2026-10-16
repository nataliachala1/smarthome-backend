import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';
import { Pool, PoolConfig } from 'pg';
import type { IClientOptions } from 'mqtt';
import {
  MQTT_REVOCATION_SETTINGS,
  MqttRevocationConfiguration,
  parseMqttRevocationConfig,
} from '../../../../config/mqtt-revocation-config';
import { MqttRevocationWorker } from '../../application/services/mqtt-revocation.worker';
import {
  MqttRevocationDatabaseUnsafeError,
  MqttRevocationLoop,
} from '../../application/services/mqtt-revocation.loop';
import { PostgresMqttRevocationStore } from '../persistence/postgres-mqtt-revocation.store';
import { assertMqttRevocationDatabase } from '../persistence/mqtt-revocation-database.audit';
import { MqttRuntimeService } from './mqtt-runtime.service';
import { MqttRevocationConnection } from './identity/mqtt-revocation.connection';

@Injectable()
export class MqttRevocationResources {
  pool(options: PoolConfig): Pool {
    return new Pool(options);
  }
  broker(url: string, options: IClientOptions): MqttRevocationConnection {
    return new MqttRevocationConnection(url, options);
  }
}

@Injectable()
export class MqttRevocationRuntimeService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MqttRevocationRuntimeService.name);
  private pool?: Pool;
  private loop?: MqttRevocationLoop;
  private initialized = false;
  private initialization?: Promise<void>;
  private closed = false;
  private readonly config: MqttRevocationConfiguration;

  constructor(
    configService: ConfigService,
    private readonly mqtt: MqttRuntimeService,
    private readonly resources: MqttRevocationResources,
  ) {
    this.config = parseMqttRevocationConfig(
      Object.fromEntries(
        MQTT_REVOCATION_SETTINGS.map((key) => [
          key,
          configService.get<unknown>(key),
        ]),
      ),
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.enabled || this.initialized || this.closed) return;
    this.initialized = true;
    this.initialization = this.initialize();
    await this.initialization;
  }

  private async initialize(): Promise<void> {
    const config = this.config;
    if (!config.enabled) return;
    try {
      let ca: Buffer | undefined;
      if (config.databaseCaFile) {
        try {
          ca = readFileSync(config.databaseCaFile);
          const pem = ca.toString('utf8');
          const pattern =
            /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
          const certificates = pem.match(pattern);
          if (!certificates?.length || pem.replace(pattern, '').trim())
            throw new Error();
          for (const certificate of certificates)
            new X509Certificate(certificate);
          createSecureContext({ ca, minVersion: 'TLSv1.2' });
        } catch {
          throw new Error('MQTT_REVOCATION_DATABASE_CA_INVALID');
        }
      }
      this.pool = this.resources.pool({
        ...config.database,
        ssl: config.databaseTls
          ? {
              rejectUnauthorized: true,
              minVersion: 'TLSv1.2',
              ...(ca ? { ca } : {}),
            }
          : false,
        max: 1,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        query_timeout: 5000,
        statement_timeout: 5000,
        lock_timeout: 3000,
        application_name: 'smarthome-mqtt-revocation',
      });
      this.pool.on('error', () =>
        this.logger.warn('MQTT_REVOCATION_DATABASE_CONNECTION_LOST'),
      );
      await assertMqttRevocationDatabase(this.pool);
      const broker = this.resources.broker(this.mqtt.config.brokerUrl!, {
        ...this.mqtt.clientOptions('control'),
        username: config.adminUsername,
        password: config.adminPassword,
        clientId: config.adminClientId,
        clean: true,
        reconnectPeriod: 0,
        rejectUnauthorized: true,
      });
      const pool = this.pool;
      const worker = new MqttRevocationWorker(
        new PostgresMqttRevocationStore(pool),
        broker,
      );
      this.loop = new MqttRevocationLoop(
        async () => {
          // Recheck after reconnect/role changes before any job is claimed.
          await assertMqttRevocationDatabase(pool);
          return worker.runOnce();
        },
        config.pollMs,
        (event) => {
          if (event !== 'IDLE' && event !== 'REVOKED') this.logger.warn(event);
        },
      );
      if (this.closed) return;
      this.loop.start();
      this.logger.log('MQTT_REVOCATION_STARTED');
    } catch (error) {
      await this.pool?.end().catch(() => undefined);
      this.pool = undefined;
      if (error instanceof MqttRevocationDatabaseUnsafeError) throw error;
      if (
        error instanceof Error &&
        error.message === 'MQTT_REVOCATION_DATABASE_CA_INVALID'
      )
        throw error;
      throw new Error('MQTT_REVOCATION_STARTUP_UNAVAILABLE');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.initialization?.catch(() => undefined);
    await this.loop?.stop();
    await this.pool?.end();
    this.pool = undefined;
  }

  status() {
    return {
      enabled: this.config.enabled,
      ...(this.loop?.status() ?? {
        running: false,
        lastEvent: null,
        completed: 0,
      }),
    };
  }
}
