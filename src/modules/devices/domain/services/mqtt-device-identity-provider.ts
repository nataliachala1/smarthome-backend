export type MqttIdentityAclType =
  | 'publishClientSend'
  | 'publishClientReceive'
  | 'subscribeLiteral'
  | 'subscribePattern'
  | 'unsubscribeLiteral'
  | 'unsubscribePattern';

export interface MqttIdentityAcl {
  readonly type: MqttIdentityAclType;
  readonly topic: string;
  readonly priority: number;
}

export interface PrepareMqttIdentityInput {
  readonly operationId: string;
  readonly username: string;
  readonly clientId: string;
  readonly roleName: string;
  readonly password: string;
  /**
   * Prefijo de tópicos del equipo reservado.
   * El orquestador debe derivarlo de MqttTopicContract.shellyPrefix(manufacturerDeviceId)
   * después de verificar ownership, sesión y manufacturerDeviceId.
   * Nunca confiar en un prefijo introducido por el cliente HTTP/móvil.
   */
  readonly topicScope: string;
  readonly acls: readonly MqttIdentityAcl[];
}

/** Verifica una identidad ya preparada sin manejar ni revelar su password. */
export type VerifyPreparedMqttIdentityInput = Pick<
  PrepareMqttIdentityInput,
  'username' | 'clientId' | 'roleName' | 'topicScope' | 'acls'
>;

export interface MqttBrokerIdentitySnapshot {
  readonly username: string;
  readonly clientId: string;
  readonly disabled: boolean;
  readonly roleNames: readonly string[];

  /**
   * null indica que el proveedor no puede demostrar
   * la cantidad de conexiones autenticadas.
   * No constituye por si solo una prueba de posesion fisica.
   */
  readonly authenticatedConnectionCount: number | null;
}

/**
 * Administracion de credenciales individuales MQTT.
 *
 * Nunca utiliza las credenciales MQTT de control o telemetria
 * del backend.
 *
 * Un fallo de comunicacion con el broker debe lanzar un error.
 * No debe interpretarse como identidad ausente o revocada.
 */
export abstract class MqttDeviceIdentityProvider {
  /**
   * Prepara la identidad sin permitir todavia su conexion.
   * Al retornar, deben estar confirmados el clientId,
   * los permisos exactos y el estado deshabilitado.
   */
  abstract prepareDisabled(
    input: PrepareMqttIdentityInput,
  ): Promise<void>;

  /**
   * null significa ausencia confirmada por el broker.
   * Error o timeout significa estado desconocido.
   */
  abstract inspectIdentity(
    username: string,
  ): Promise<MqttBrokerIdentitySnapshot | null>;

  /** Reconsulta cliente, grupos, rol y cinco ACL exactas antes de SQL 027. */
  abstract verifyPreparedDisabled(
    input: VerifyPreparedMqttIdentityInput,
  ): Promise<void>;

  abstract enableIdentity(username: string): Promise<void>;

  /**
   * La implementacion debe confirmar la revocacion
   * consultando nuevamente el estado del broker.
   */
  abstract disableIdentity(username: string): Promise<void>;
}
