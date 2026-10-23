# HU11 — Historial transaccional de identidades MQTT

Fecha: 2026-10-15. Cuarto incremento en `11-dev`, sobre backend `35ef316b7afb32102a2373163b967be7a81f0f5f` y BD `ef84f7eac24ab7b3e83c2b13b92cfe940a315f4f`. Diff y resultados de pruebas presentados; commit/push de este incremento autorizados por el usuario el 2026-10-15.

## Resultado

El registro de identidad conserva el último error, pero lo reemplaza en cada intento. Este incremento añade un historial técnico que mantiene cada transición confirmada en PostgreSQL. Por ejemplo, un error incierto y un fallo de conexión siguen consultables después de una revocación exitosa, aunque `mqtt_identity.last_error_code` vuelva a `NULL`.

La nueva tabla `devices.mqtt_identity_event` tiene ocho columnas: ID secuencial, referencia a identidad, tipo de evento, estado anterior, estado resultante, número de intento, código de error y fecha de observación. No almacena contraseñas, verificadores, tokens de reclamo, payloads MQTT ni JSON libre. El modelo Prisma refleja la tabla; Liquibase administra restricciones, permisos y triggers.

| Evento | Qué demuestra |
| --- | --- |
| `BASELINE_SNAPSHOT` | Estado observado al aplicar esta migración a una identidad existente. No reconstruye su historia. |
| `REGISTERED` | Se confirmó el registro SQL de una identidad nueva. No demuestra posesión ni entrega de credenciales. |
| `REVOKE_REQUESTED` | Se confirmó la transición a pendiente dentro de la baja del dispositivo. |
| `ATTEMPT_STARTED` | Se confirmó un reclamo con lease nuevo. No demuestra que se haya enviado un comando MQTT. |
| `RETRY_SCHEDULED` | Se confirmó un intento fallido/incierto con un código permitido y reintento pendiente. |
| `REVOKED` | Se confirmó la finalización SQL que el trabajador solicita después del ACK administrativo del broker. No demuestra apagado físico. |

Los eventos se insertan mediante un trigger AFTER en la misma transacción que cambia la identidad. Un rollback de registro, baja, reclamo o finalización revierte su evento. Si insertar el historial falla, también falla la operación que lo originó. Una confirmación con token viejo/vencido o un registro idempotente no crean eventos adicionales.

El lease nuevo distingue intentos incluso cuando el contador alcanza su máximo. Su valor no se copia al historial. Los IDs secuenciales pueden tener huecos por rollback; ordenar por ID permite recorrer la historia de una identidad, pero no establece un orden global de commits entre identidades. Las fechas son de observación dentro de la transacción, no tiempos medidos en el broker.

Si el broker aplica una revocación y después falla la escritura SQL, no se inventa un evento exitoso. Queda un intento sin resultado confirmado; el siguiente lease permite reintentar y registrar el resultado posterior.

## Protección y alcance

La tabla tiene RLS sin políticas de acceso directo. API, ingesta, worker general, readonly, administrador de aplicación, registrar y revocador no reciben permisos sobre ella ni su secuencia; tampoco pueden ejecutar directamente sus funciones trigger. No se agrega endpoint ni permiso de lectura para usuarios de hogares.

Un trigger adicional rechaza UPDATE, DELETE y TRUNCATE del historial, también para evitar accidentes de una cuenta privilegiada. La FK impide borrar físicamente una identidad referenciada. Un administrador con capacidad de alterar tablas/triggers puede cambiar estas protecciones: no se presenta como almacenamiento inviolable ni auditoría criptográfica.

Este historial no sustituye `identity_audit.audit_log`, cuya semántica existente pertenece a eventos explícitos de Nest. No atribuye un actor humano a operaciones técnicas ni reconstruye autorizaciones anteriores. La auditoría de emisión/rotación y de actores sigue pendiente con sus respectivos flujos.

## Integración y despliegue coordinado

- BD agrega el changeset `hu11-mqtt-identity-events-v1` en `releases/011_mqtt_identity_events/`. No modifica ningún changeset aplicado: la secuencia pasa de 63 a 64.
- Backend actualiza el modelo Prisma, la auditoría del trabajador y el harness de integración.
- `scripts/audit-mqtt-revocation.sql` y su copia backend deben devolver ahora **nueve** comprobaciones válidas. La nueva exige tabla/RLS, triggers esperados activos y sesión `session_replication_role=origin`; se revisan también las dos funciones nuevas, su SECURITY DEFINER/search_path y permisos.
- El backend actualizado con el trabajador habilitado rechaza una BD que aún no tenga esta migración. En operación, un fallo de auditoría suspende nuevos reclamos. Es una comprobación previa, no un bloqueo contra cambios administrativos posteriores.
- Aplicar primero la revisión BD aprobada y después desplegar el backend coordinado. Las funciones de registro/reclamo/finalización conservan su firma e implementación anteriores; el historial también captura sus invocaciones desde el backend anterior.
- El trabajador permanece desactivado por defecto. Este incremento no cambia `.env` ni provisiona cuentas o certificados.

La migración bloquea escrituras de identidad durante la captura inicial y la instalación del trigger, dentro de la transacción Liquibase. Limita a 5 segundos la espera de bloqueos; si no los consigue, falla para reintentar en una ventana adecuada. No se certificó el tiempo de backfill con volúmenes productivos.

El rollback toma bloqueos y exige historial vacío. Si existen observaciones o eventos, devuelve `MQTT_IDENTITY_HISTORY_ROLLBACK_REQUIRES_EMPTY_HISTORY`; no borra datos para poder revertir. Una reversión de aplicación debe conservar el historial. No se implementa purga automática: la política de retención y la medición de crecimiento quedan pendientes.

## Validación

- **255 pruebas unitarias** en 12 suites aprobadas.
- **104 pruebas con PostgreSQL y broker TLS reales**: 76 de persistencia/runtime y 28 de broker. Incluyen 22 casos nuevos de historial y ampliaciones a los casos existentes de concurrencia, errores y desconexión real de clientes MQTT simulados.
- Se comprueba historial exacto de varios reintentos, rechazo de confirmaciones obsoletas/duplicadas, rollback de registro/baja/reclamo/finalización, fallo de escritura del evento y contador de intentos saturado.
- Se prueban seis LOGIN reales sin privilegios de migración: rechazo de lectura/escritura de historial, uso de secuencia y ejecución directa de funciones trigger. También guard contra UPDATE/DELETE/TRUNCATE privilegiados y detección de triggers/RLS deshabilitados o sesión de replicación.
- Liquibase: migración limpia, rollback vacío de los dos changesets HU11 y reaplicación; actualización **62 → 63 → 64** con checksums previos intactos. Tres identidades preexistentes (registrada, pendiente y revocada) conservan todos sus campos y reciben únicamente su snapshot. El rollback de historial poblado se rechaza sin cambiar datos/changelog.
- Build Nest, `tsc --noEmit`, ESLint de los tres archivos TS afectados, sintaxis Node del harness, validación y generación Prisma aprobados. Prisma utilizó una configuración temporal sin `.env` ni conexión a la base del proyecto.
- Los contenedores y certificados propios de la ejecución se retiraron al terminar. Los cambios de HU13 se conservaron y sus diffs anteriores siguen coincidiendo.

La fixture PostgreSQL no usa TLS; Mosquitto sí usa TLS real. No se probaron equipos físicos, producción, carga/volumen de historial ni tiempos de migración productivos. No cambió el contrato de topics HU10 en este incremento.

Reproducir desde la copia de backend: `node scripts/test-mqtt-revocation.cjs ../hu11-database`. El harness usa únicamente bases y broker nuevos en loopback, con credenciales aleatorias; no lee `.env`. El reinicio de datos entre casos usa una cuenta privilegiada únicamente dentro de la fixture desechable y restaura su trigger de protección transaccionalmente.

## Pendientes

Reserva previa a emisión, posesión/pairing, entrega y compensación de credenciales, coordinación de rotación con revocación, métricas operativas y despliegue siguen pendientes. Este avance completa la historia de las operaciones HU11 ya implementadas; no habilita alta cloud ni certifica Shelly físico. HU13 y HU16 aún requieren integración.

## Referencias

- [PostgreSQL 16: comportamiento transaccional de triggers](https://www.postgresql.org/docs/16/trigger-definition.html).
- [PostgreSQL 16: definición de triggers y eventos TRUNCATE](https://www.postgresql.org/docs/16/sql-createtrigger.html).
- [PostgreSQL 16: RLS y alcance de propietarios/roles privilegiados](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).
