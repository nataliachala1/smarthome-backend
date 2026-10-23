# HU11 — Ejecución automática del trabajador de revocación

Actualización: el [incremento de compatibilidad EMQX](HU11_EMQX_SERVERLESS_PAIRING_READINESS.md) exige `MQTT_IDENTITY_PROVIDER=mosquitto-dynamic-security` para habilitar este trabajador. `emqx-serverless` se rechaza antes de abrir recursos. La evidencia histórica siguiente corresponde exclusivamente a Mosquitto; la administración de identidades del proveedor de producción sigue pendiente.

Este documento conserva la evidencia del tercer incremento. El [cuarto incremento](HU11_MQTT_IDENTITY_HISTORY.md) añade historial transaccional y amplía la auditoría operativa de ocho a nueve comprobaciones; consultar allí la revisión BD requerida.

Fecha: 2026-10-15. Tercer incremento en `11-dev`, desde backend `20eee233274bf8d89c479fdb44a2679e2a2d157a` y BD `eeef0824a445e64d77fefcfaf0c60ca2a26eeaf2`. Diff y resultados de pruebas presentados; commit/push de este incremento autorizados por el usuario el 2026-10-15.

## Resultado

El trabajador de revocación ahora está registrado como proveedor de `DevicesModule` y puede procesar automáticamente tareas persistentes. `MQTT_REVOCATION_ENABLED=false` es el valor predeterminado: no crea un pool ni conexiones administrativas. El cambio no habilita el trabajador en `.env` ni ejecuta una migración sobre la instalación del proyecto.

Cuando se habilita, Nest valida la configuración y audita la conexión PostgreSQL al iniciar. Solo después programa ciclos seriales: auditoría de permisos → reclamo de tarea → conexión administrativa MQTT nueva → `disableClient` → confirmación SQL. La cola y sus leases/reintentos conservan el contrato del segundo incremento; no se cambian tablas, funciones, triggers, Prisma ni changesets.

## Archivos y responsabilidades

| Archivo | Responsabilidad |
| --- | --- |
| `src/config/mqtt-revocation-config.ts` | Configuración optativa; credenciales separadas, destino BD coherente, TLS y límites. |
| `src/modules/devices/infrastructure/messaging/mqtt-revocation-runtime.service.ts` | Ciclo de vida Nest, pool dedicado, auditoría, composición del trabajador y cierre. |
| `src/modules/devices/application/services/mqtt-revocation.loop.ts` | Ciclos sin solapamiento; códigos de resultado y parada que espera la tarea en curso. |
| `src/modules/devices/infrastructure/messaging/identity/mqtt-revocation.connection.ts` | Conexión limpia por tarea, sin reconexión ni cola QoS0; cierre forzado al finalizar. |
| `src/modules/devices/infrastructure/persistence/mqtt-revocation-database.audit.ts` | Auditoría de catálogos antes de cada reclamo; sin SQL de modificación. |
| BD `scripts/audit-mqtt-revocation.sql` | Misma consulta para verificación manual con el LOGIN real. La suite verifica igualdad de ambos textos. |
| `src/main.ts` | Habilita hooks de cierre de Nest para señales admitidas. |

## Configuración explícita

| Variable | Regla |
| --- | --- |
| `MQTT_REVOCATION_ENABLED` | Solo `true`/`false`; predeterminado `false`. |
| `DATABASE_MQTT_REVOKE_URL` | URL PostgreSQL con usuario y contraseña propios. Mismo host, puerto y base que API e ingesta; LOGIN distinto de ambos. Sin query ni fragmento. |
| `DATABASE_MQTT_REVOKE_TLS` | Predeterminado `true` en producción y `false` en otros entornos. Producción rechaza `false`. |
| `DATABASE_MQTT_REVOKE_CA_FILE` | Bundle PEM opcional para la BD, solo con TLS. Sin archivo se usan CAs del sistema de Node. |
| `MQTT_ADMIN_USERNAME` / `MQTT_ADMIN_PASSWORD` | Identidad administrativa explícita; no se reutiliza `MQTT_USERNAME` ni se usa fallback a credenciales de servicio. |
| `MQTT_ADMIN_CLIENT_ID` | Obligatorio, distinto de los client IDs de servicio; asignar uno exclusivo por réplica y respetar el binding del broker. |
| `MQTT_REVOCATION_POLL_MS` | Entre 250 y 60000 ms; predeterminado 1000. Es una pausa después de finalizar cada ciclo. |

MQTT usa el mismo `MQTT_BROKER_URL` validado por HU10, exige `mqtts://` también en desarrollo y reutiliza el bundle `MQTT_TLS_CA_FILE`. El cliente administrativo usa credenciales propias, `clean=true`, MQTT 5, `reconnectPeriod=0` y verificación de certificado. `NODE_TLS_REJECT_UNAUTHORIZED=0` se rechaza.

La configuración de PostgreSQL se pasa como campos separados, sin `connectionString` ni parámetros que puedan sustituir opciones TLS. El pool tiene máximo una conexión; conexión, consultas y statements tienen límite de 5 segundos y los locks de 3 segundos. TLS usa `rejectUnauthorized=true` y mínimo TLS 1.2. La validación de configuración no prueba por sí sola que un servidor productivo tenga certificados correctos.

## Auditoría y permisos

La auditoría devuelve ocho comprobaciones de solo lectura. Se exige el LOGIN real, sin `SET ROLE`, con privilegios activos de `smarthome_mqtt_revoke`. Se rechazan membresías adicionales, SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB/REPLICATION, propiedad de la base u objetos de negocio, privilegios directos de tabla/columna y capacidad CREATE en esquemas de negocio.

También se comprueba RLS de `mqtt_identity` y la presencia/configuración de las cuatro funciones HU11: SECURITY DEFINER con `search_path` fijo, sin EXECUTE a PUBLIC y con ejecución del trabajador limitada a reclamar/finalizar. Una configuración ausente o nula falla cerrada. Esto audita el alcance descrito; no certifica la integridad del código SQL ni sustituye la administración de privilegios del servidor.

Si la auditoría inicial falla, se cierra el pool y el arranque habilitado falla con código estable. En operación se repite antes de cada ciclo: si cambian permisos, no se reclaman nuevas tareas hasta corregirlos. La comprobación es una fotografía de permisos, no un bloqueo administrativo contra cambios posteriores.

El rol de BD del revocador no puede registrar identidades. Las credenciales MQTT administrativas sí tienen autoridad sobre la API Dynamic Security del broker; Mosquitto no limita sus comandos mediante el ACL del topic. Esta implementación solo envía `disableClient`, pero las credenciales deben mantenerse separadas de usuarios, dispositivos y servicio de ingesta.

## Recuperación, cierre y diagnóstico

Cada tarea utiliza un cliente MQTT nuevo y lo descarta al finalizar. Un fallo no provoca reenvío automático de comandos: la única fuente de reintentos es la tarea SQL. La conexión y la respuesta administrativa están limitadas a 5 segundos cada una; el cierre fuerza la destrucción del stream si no termina en 1 segundo. Un error previo al envío queda como no disponible y uno incierto después del envío conserva el tratamiento de HU11.

Los ciclos son seriales. Al cerrar, se cancela el siguiente timer, se espera al ciclo en curso y después se termina el pool. También se cubre cierre durante la auditoría inicial. No se pierde la tarea si el proceso termina abruptamente: la recuperación depende del lease ya probado en BD.

`status()` es un método interno con `enabled`, `running`, `lastEvent` y contador `completed` desde el arranque. No se añade un endpoint público ni métricas Prometheus. Los logs usan códigos fijos: `MQTT_REVOCATION_STARTED`, `MQTT_REVOCATION_DATABASE_CONNECTION_LOST`, `MQTT_REVOCATION_DATABASE_UNSAFE`, `MQTT_REVOCATION_RUNTIME_UNAVAILABLE`, `RETRY_SCHEDULED` o `LEASE_LOST`. No se imprimen URLs, contraseñas, UUIDs de reclamo ni payloads administrativos. La observabilidad de tamaño/edad de cola sigue pendiente de HU14.

## Evidencia ejecutada

- **255 pruebas unitarias** en 12 suites, incluyendo 48 nuevas de configuración, conexión, programación y ciclo de vida.
- **82 pruebas con PostgreSQL y Mosquitto TLS reales**: 54 de persistencia/runtime y 28 del adaptador original. Las 14 nuevas verifican auditoría, aislamiento, grants por columna/PUBLIC, búsqueda de objetos sin search_path fijo, sesión privilegiada detrás de SET ROLE y ejecución automática desde Nest.
- Recuperación real al deshabilitar temporalmente la identidad administrativa del broker y volver a habilitarla: la tarea queda pendiente y una conexión nueva completa la revocación.
- Reparación de permisos durante ejecución: el trabajador suspende reclamos al añadir membresía de ingesta y vuelve a procesar al retirarla. El cierre de contexto Nest deja cero conexiones con el `application_name` del trabajador.
- **31 pruebas sintéticas HU10**, compilación Nest, TypeScript y ESLint de archivos TS afectados aprobados.
- Liquibase valida y migra una BD desechable limpia; rollback vacío y reaplicación; upgrade **62 → 63**, preservando checksums anteriores y datos de prueba. Este incremento no agrega changesets.

Reproducción desde el backend: `node scripts/test-mqtt-revocation.cjs ../hu11-database`. Requiere Docker, OpenSSL y las imágenes locales documentadas en el segundo incremento. Docker Desktop se inició en segundo plano porque estaba detenido; solo se ejecutaron migraciones y comandos de broker sobre servicios nuevos de prueba. Sus contenedores y certificados se retiraron al terminar.

La fixture PostgreSQL usa loopback sin TLS; las opciones de PostgreSQL TLS se verificaron en pruebas unitarias. MQTT sí se probó con TLS real. Se verificó `context.close()`; no se declara prueba de señales del sistema operativo ni de parada de contenedores productivos. Nest documenta limitaciones de señales en Windows.

## Preparación de despliegue y pendientes

Antes de habilitar: aplicar la revisión BD aprobada, provisionar un LOGIN que solo herede `smarthome_mqtt_revoke`, ejecutar `scripts/audit-mqtt-revocation.sql` con ese LOGIN real y exigir ocho `passed=true`; provisionar la identidad administrativa del broker y certificados; configurar un client ID exclusivo por réplica y observar una revocación en staging. No incluir secretos en comandos de revisión ni informes. Cambiar variables requiere reiniciar el proceso.

El código de ejecución ya existe; **no se activó el trabajador en la instalación del proyecto**. No se registra automáticamente una identidad para dispositivos anteriores. Siguen pendientes reserva previa al alta, posesión/pairing, compensación de fallos al emitir credenciales, coordinación de rotación y revocación, auditoría completa, observabilidad de cola y despliegue. HU13 y HU16 deben integrarse; no se certifican Shelly físico ni cloud productivo.

## Referencias

- [NestJS: ciclo de vida y cierre](https://docs.nestjs.com/fundamentals/lifecycle-events).
- [node-postgres: pool y cierre de conexiones](https://node-postgres.com/apis/pool).
- [node-postgres: configuración TLS y parámetros de conexión](https://node-postgres.com/features/ssl).
