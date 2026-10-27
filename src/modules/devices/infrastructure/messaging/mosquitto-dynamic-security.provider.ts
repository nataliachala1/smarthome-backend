import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';
import { connect, type IClientOptions } from 'mqtt';
import {
  MqttDeviceIdentityProvider,
  type MqttBrokerIdentitySnapshot,
  type MqttIdentityAcl,
  type PrepareMqttIdentityInput,
  type VerifyPreparedMqttIdentityInput,
} from '../../domain/services/mqtt-device-identity-provider';

const REQUEST_TOPIC = '$CONTROL/dynamic-security/v1';
const RESPONSE_TOPIC = '$CONTROL/dynamic-security/v1/response';
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const TIMEOUT_MS = 8000;

type JsonObject = Record<string, unknown>;

class DynsecCommandError extends Error {
  constructor(readonly dynsecCommand: string, readonly brokerError: string) {
    super(`Dynsec ${dynsecCommand} rejected`);
  }
}

type DynsecReply = {
  command?: unknown;
  correlationData?: unknown;
  error?: unknown;
  data?: unknown;
};

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function unavailable(code: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ code });
}

/**
 * Administra identidades MQTT mediante el API oficial de Dynamic Security.
 *
 * IMPORTANTE: no registrar este servicio en DevicesModule ni exponerlo por HTTP
 * hasta que el flujo transaccional de pairing/revocacion esté implementado.
 * Nunca comparte MQTT_USERNAME / MQTT_PASSWORD con dispositivos.
 */
@Injectable()
export class MosquittoDynamicSecurityProvider extends MqttDeviceIdentityProvider {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  private settings(): { url: string; options: IClientOptions } {
    const rawUrl = this.configService.get<string>('MQTT_DYNSEC_ADMIN_URL');
    const username = this.configService.get<string>('MQTT_DYNSEC_ADMIN_USERNAME');
    const password = this.configService.get<string>('MQTT_DYNSEC_ADMIN_PASSWORD');
    const caPath = this.configService.get<string>('MQTT_DYNSEC_ADMIN_CA_FILE');
    const environment = this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
    if (!rawUrl || !username || !password) {
      throw unavailable('MQTT_DYNSEC_ADMIN_NOT_CONFIGURED');
    }

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw unavailable('MQTT_DYNSEC_ADMIN_URL_INVALID');
    }
    const encrypted = url.protocol === 'mqtts:';
    const localhost = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (
      !['mqtt:', 'mqtts:'].includes(url.protocol) ||
      !url.hostname ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname !== '' && url.pathname !== '/') ||
      (environment === 'production' && !encrypted) ||
      (!encrypted && !localhost)
    ) {
      throw unavailable('MQTT_DYNSEC_ADMIN_TRANSPORT_UNSAFE');
    }

    // La CA privada de desarrollo se proporciona por ruta de archivo local,
    // nunca mediante contenido PEM en variables, logs o respuestas HTTP.
    // En produccion es opcional si el broker utiliza una CA publica.
    let ca: Buffer | undefined;
    if (caPath) {
      if (!encrypted) {
        throw unavailable('MQTT_DYNSEC_ADMIN_CA_REQUIRES_TLS');
      }
      try {
        ca = readFileSync(caPath);
        const pem = ca.toString('utf8');
        const certificates = pem.match(
          /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
        );
        if (!certificates?.length) throw new Error('EMPTY_CERTIFICATE_CHAIN');
        for (const certificate of certificates) new X509Certificate(certificate);
        if (pem.replace(
          /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
          '',
        ).trim()) throw new Error('UNEXPECTED_CERTIFICATE_CONTENT');
        createSecureContext({ ca, minVersion: 'TLSv1.2' });
      } catch {
        throw unavailable('MQTT_DYNSEC_ADMIN_CA_INVALID');
      }
    }

    return {
      url: rawUrl,
      options: {
        username,
        password,
        clientId: `smarthome-dynsec-${randomUUID()}`,
        clean: true,
        reconnectPeriod: 0,
        connectTimeout: 5000,
        protocolVersion: 5,
        ...(encrypted ? {
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          ...(ca ? { ca } : {}),
        } : {}),
      },
    };
  }

  private async command(command: string, parameters: JsonObject = {}): Promise<JsonObject> {
    const { url, options } = this.settings();
    const correlationData = randomUUID();

    return new Promise<JsonObject>((resolve, reject) => {
      const client = connect(url, options);
      let finished = false;
      const finish = (error?: Error, data?: JsonObject): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        // La conexion administrativa es de un solo uso: no hay respuestas cruzadas.
        client.end(true);
        if (error) reject(error);
        else resolve(data ?? {});
      };
      const timeout = setTimeout(() => finish(unavailable('MQTT_DYNSEC_TIMEOUT')), TIMEOUT_MS);
      client.on('error', () => finish(unavailable('MQTT_DYNSEC_UNREACHABLE')));
      client.on('close', () => finish(unavailable('MQTT_DYNSEC_DISCONNECTED')));
      client.on('message', (topic, payload) => {
        if (topic !== RESPONSE_TOPIC) return;
        let body: JsonObject | null;
        try {
          body = object(JSON.parse(payload.toString('utf8')));
        } catch {
          return;
        }
        const responses = body?.responses;
        if (!Array.isArray(responses)) return;
        const matching = responses
          .map((entry: unknown) => object(entry))
          .find((entry: JsonObject | null) => entry?.correlationData === correlationData);
        if (!matching) return;
        const reply = matching as DynsecReply;
        if (reply.command !== command) {
          finish(unavailable('MQTT_DYNSEC_MISMATCHED_RESPONSE'));
          return;
        }
        if (typeof reply.error === 'string') {
          finish(new DynsecCommandError(command, reply.error));
          return;
        }
        finish(undefined, object(reply.data) ?? {});
      });
      client.on('connect', () => {
        client.subscribe(RESPONSE_TOPIC, { qos: 1 }, (subscribeError, grants) => {
          if (subscribeError || !grants?.some((grant) => grant.qos !== 128)) {
            finish(unavailable('MQTT_DYNSEC_RESPONSE_SUBSCRIPTION_DENIED'));
            return;
          }
          const body = JSON.stringify({
            commands: [{ command, ...parameters, correlationData }],
          });
          client.publish(REQUEST_TOPIC, body, { qos: 1 }, (publishError) => {
            if (publishError) finish(unavailable('MQTT_DYNSEC_PUBLISH_FAILED'));
          });
        });
      });
    });
  }

  private validateIdentifier(value: string): void {
    if (!IDENTIFIER.test(value)) {
      throw unavailable('MQTT_DYNSEC_INVALID_IDENTIFIER');
    }
  }

  async inspectIdentity(username: string): Promise<MqttBrokerIdentitySnapshot | null> {
    this.validateIdentifier(username);
    let data: JsonObject;
    try {
      data = await this.command('getClient', { username });
    } catch (error) {
      // Solo la respuesta EXPLICITA del broker significa identidad ausente.
      // Timeout, conexion fallida o error administrativo son estado desconocido.
      if (
        error instanceof DynsecCommandError &&
        error.dynsecCommand === 'getClient' &&
        error.brokerError === 'Client not found'
      ) return null;
      throw error;
    }
    const client = object(data.client);
    if (!client || client.username !== username || typeof client.clientid !== 'string') {
      throw unavailable('MQTT_DYNSEC_INVALID_CLIENT_RESPONSE');
    }
    const roles = Array.isArray(client.roles) ? client.roles : [];
    return {
      username,
      clientId: client.clientid,
      disabled: client.disabled === true,
      roleNames: roles
        .map((entry: unknown) => object(entry)?.rolename)
        .filter((name: unknown): name is string => typeof name === 'string'),
      authenticatedConnectionCount: Array.isArray(client.connections)
        ? client.connections.length
        : null,
    };
  }

  private validateScopedAcls(input: VerifyPreparedMqttIdentityInput): void {
    // El contrato de los cinco permisos llega exclusivamente del backend,
    // derivado de la sesion y del manufacturerDeviceId reservado.
    const scope = input.topicScope;
    if (
      typeof scope !== 'string' ||
      scope.length > 256 ||
      !/^[A-Za-z0-9_.:-]+(?:\/[A-Za-z0-9_.:-]+)*$/.test(scope) ||
      (scope.includes('/') && scope.split('/').at(-2) !== 'devices')
    ) {
      throw unavailable('MQTT_DYNSEC_INVALID_TOPIC_SCOPE');
    }

    if (!Array.isArray(input.acls) || input.acls.length !== 5) {
      throw unavailable('MQTT_DYNSEC_UNSAFE_ACL');
    }

    const validatedAcls: unknown[] = input.acls;

    if (!validatedAcls.every(
      (acl): acl is { type: string; topic: string; priority: number } =>
        typeof acl === 'object' &&
        acl !== null &&
        'type' in acl &&
        typeof acl.type === 'string' &&
        'topic' in acl &&
        typeof acl.topic === 'string' &&
        'priority' in acl &&
        typeof acl.priority === 'number',
    )) {
      throw unavailable('MQTT_DYNSEC_UNSAFE_ACL');
    }

    const switchPermissions = validatedAcls.filter(
      (acl) => acl.type === 'publishClientSend' &&
        acl.topic.startsWith(`${scope}/status/switch:`) &&
        /^(?:0|[1-9]\d{0,2})$/.test(acl.topic.slice(`${scope}/status/switch:`.length)),
    );
    if (switchPermissions.length !== 1) {
      throw unavailable('MQTT_DYNSEC_UNSAFE_ACL');
    }

    const required = new Set([
      `publishClientSend:${switchPermissions[0].topic}`,
      `publishClientSend:${scope}/events/rpc`,
      `subscribeLiteral:${scope}/rpc`,
      `publishClientReceive:${scope}/rpc`,
      `unsubscribeLiteral:${scope}/rpc`,
    ]);
    const received = new Set<string>();
    for (const acl of validatedAcls) {
      const key = `${acl.type}:${acl.topic}`;
      if (acl.priority !== 10 || !required.has(key) || received.has(key)) {
        throw unavailable('MQTT_DYNSEC_UNSAFE_ACL');
      }
      received.add(key);
    }
    if (received.size !== required.size) {
      throw unavailable('MQTT_DYNSEC_UNSAFE_ACL');
    }
  }

  /**
   * Verificacion independiente inmediatamente ANTES de confirmar la SQL 027.
   * La operacion y su lease siguen siendo responsabilidad del worker SQL.
   */
  async verifyPreparedDisabled(input: VerifyPreparedMqttIdentityInput): Promise<void> {
    this.validateIdentifier(input.username);
    this.validateIdentifier(input.clientId);
    this.validateIdentifier(input.roleName);
    this.validateScopedAcls(input);

    const clientResponse = await this.command('getClient', { username: input.username });
    const client = object(clientResponse.client);
    const roles = Array.isArray(client?.roles) ? client.roles : null;
    const groups = client?.groups;
    if (
      !client || client.username !== input.username ||
      client.clientid !== input.clientId || client.disabled !== true ||
      !roles || roles.length !== 1 ||
      object(roles[0])?.rolename !== input.roleName ||
      object(roles[0])?.priority !== 10 ||
      (groups !== undefined && !Array.isArray(groups)) ||
      (Array.isArray(groups) && groups.length !== 0)
    ) {
      throw unavailable('MQTT_DYNSEC_PREPARE_NOT_CONFIRMED');
    }

    const roleResponse = await this.command('getRole', { rolename: input.roleName });
    const role = object(roleResponse.role);
    const actualAcls = role?.acls;
    // Mosquitto DynSec getRole identifica el rol por el nombre solicitado,
    // pero su respuesta real puede omitir rolename. Si lo incluye debe coincidir.
    // Mantener la verificacion estricta de las cinco ACL a continuacion.
    if ((role?.rolename !== undefined && role.rolename !== input.roleName) ||
        !Array.isArray(actualAcls) ||
        actualAcls.length !== input.acls.length) {
      throw unavailable('MQTT_DYNSEC_ACLS_NOT_CONFIRMED');
    }

    const expected = new Set(input.acls.map((acl) =>
      JSON.stringify([acl.type, acl.topic, acl.priority, true])));
    const actual = new Set<string>();
    for (const item of actualAcls) {
      const acl = object(item);
      if (!acl || typeof acl.acltype !== 'string' ||
          typeof acl.topic !== 'string' || !Number.isInteger(acl.priority) ||
          acl.allow !== true) {
        throw unavailable('MQTT_DYNSEC_ACLS_NOT_CONFIRMED');
      }
      actual.add(JSON.stringify([acl.acltype, acl.topic, acl.priority, acl.allow]));
    }
    if (actual.size !== expected.size ||
        [...expected].some((key) => !actual.has(key))) {
      throw unavailable('MQTT_DYNSEC_ACLS_NOT_CONFIRMED');
    }
  }

  async prepareDisabled(input: PrepareMqttIdentityInput): Promise<void> {
    this.validateIdentifier(input.username);
    this.validateIdentifier(input.clientId);
    this.validateIdentifier(input.roleName);
    if (!input.operationId || input.password.length < 32 || input.acls.length === 0) {
      throw unavailable('MQTT_DYNSEC_INVALID_PROVISION_REQUEST');
    }
    this.validateScopedAcls(input);

    // NOTA: la consulta inicial y el createClient no sustituyen una reserva
    // transaccional. El orquestador de pairing deberá evitar colisiones.
    // No reemplazar ni modificar credenciales de una identidad preexistente.
    if (await this.inspectIdentity(input.username)) {
      throw unavailable('MQTT_DYNSEC_IDENTITY_ALREADY_EXISTS');
    }
    let attemptedCreate = false;
    try {
      // Sin password ni roles: esta identidad no puede autenticar.
      attemptedCreate = true;
      await this.command('createClient', {
        username: input.username,
        clientid: input.clientId,
        textdescription: input.operationId,
      });
      await this.command('disableClient', { username: input.username });
      // La identidad sigue deshabilitada durante la configuracion restante.
      await this.command('createRole', {
        rolename: input.roleName,
        acls: input.acls.map((acl: MqttIdentityAcl) => ({
          acltype: acl.type,
          topic: acl.topic,
          priority: acl.priority,
          allow: true,
        })),
      });
      await this.command('addClientRole', {
        username: input.username,
        rolename: input.roleName,
        priority: 10,
      });
      await this.command('setClientPassword', {
        username: input.username,
        password: input.password,
      });
      await this.verifyPreparedDisabled({
        username: input.username,
        clientId: input.clientId,
        roleName: input.roleName,
        topicScope: input.topicScope,
        acls: input.acls,
      });
    } catch (error) {
      // Compensacion de mejor esfuerzo: un timeout sigue siendo estado incierto.
      // NO entregar la password ni marcar identidad lista si hubo error.
      if (
        attemptedCreate && !(
          error instanceof DynsecCommandError &&
          error.dynsecCommand === 'createClient' &&
          error.brokerError === 'Client already exists'
        )
      ) {
        try {
          await this.command('disableClient', { username: input.username });
        } catch { /* Estado desconocido: reconciliar desde la cola persistente. */ }
      }
      throw error;
    }
  }

  async enableIdentity(username: string): Promise<void> {
    this.validateIdentifier(username);
    const before = await this.inspectIdentity(username);
    if (!before || !before.disabled || before.roleNames.length !== 1) {
      throw unavailable('MQTT_DYNSEC_ENABLE_PRECONDITION_FAILED');
    }
    await this.command('enableClient', { username });
    const after = await this.inspectIdentity(username);
    if (!after || after.disabled || after.clientId !== before.clientId) {
      throw unavailable('MQTT_DYNSEC_ENABLE_NOT_CONFIRMED');
    }
  }

  async disableIdentity(username: string): Promise<void> {
    this.validateIdentifier(username);
    await this.command('disableClient', { username });
    const after = await this.inspectIdentity(username);
    if (!after?.disabled) {
      throw unavailable('MQTT_DYNSEC_DISABLE_NOT_CONFIRMED');
    }
  }
}
