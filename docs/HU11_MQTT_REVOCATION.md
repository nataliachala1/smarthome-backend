# HU11 — Registro persistente y revocación durable

Este documento conserva la evidencia del segundo incremento. El [tercer incremento](HU11_MQTT_REVOCATION_RUNTIME.md) incorpora ejecución automática optativa en Nest, conexión por tarea, auditoría de permisos y cierre ordenado; consultar allí el alcance operativo vigente.

Fecha: 2026-10-15. Segundo incremento en `11-dev`. Bases publicadas: backend `a0d41581c7bd2f2bdb9ac289deb5054991214ba7`, BD `71443f27f38fc31ef08e29e8a0a60f40aad3f3db`. Diff y resultados de pruebas presentados; commit/push de este incremento autorizados por el usuario el 2026-10-15.

## Comportamiento implementado

Para un dispositivo con identidad MQTT registrada, actualizar `deleted_at` a un valor no nulo registra `REVOKE_PENDING` en la misma transacción PostgreSQL. Un rollback revierte ambas modificaciones. Un trabajador reclama una tarea, confirma la transacción, envía `disableClient` y guarda `REVOKED` solo tras recibir una respuesta administrativa positiva y correlacionada.

La confirmación de baja en BD **no significa revocación aplicada**. Durante una interrupción del broker la tarea queda pendiente. No se envía un comando OFF ni se modifica el relé físico. La desactivación temporal existente (`status=DEACTIVATED`, `deleted_at=NULL`) conserva su comportamiento; este incremento atiende la baja lógica/desvinculación.

## Artefactos coordinados

| Repositorio / archivo | Cambio |
| --- | --- |
| Backend `prisma/schema.prisma` | Modelo `mqtt_identity` y relación con el dispositivo; Liquibase sigue siendo dueño de DDL, checks y permisos. |
| Backend `src/modules/devices/application/services/mqtt-revocation.worker.ts` | Ejecución explícita de una tarea; resultados `IDLE`, `REVOKED`, `RETRY_SCHEDULED`, `LEASE_LOST`. |
| Backend `src/modules/devices/infrastructure/persistence/postgres-mqtt-revocation.store.ts` | Consultas parametrizadas a funciones SQL con un pool técnico dedicado. |
| BD `releases/011_mqtt_revocation/` | Un changeset incremental, tabla, restricciones, funciones, trigger, roles y rollback condicionado. |
| Backend `scripts/test-mqtt-revocation.cjs` | PostgreSQL y Liquibase desechables; arranque del harness TLS existente y suites coordinadas. |
| Backend `test/mqtt-revocation-postgres.e2e-spec.ts` | Pruebas de permisos, transacciones, concurrencia, recuperación e integración con broker real. |

## Identidad y permisos

`devices.mqtt_identity` conserva UUID v4 del broker, dispositivo, ID de fabricante, estado, marcas temporales, número de intentos y código estable del último fallo. El usuario MQTT se deriva como `device-<uuid>`. No guarda contraseñas, hashes ni verificadores. El token de reclamo es un mecanismo interno de concurrencia, no una credencial del broker.

Hay una sola referencia por dispositivo y por fabricante. La FK impide borrar físicamente el dispositivo referenciado. El índice global existente de fabricante sigue incluyendo dispositivos dados de baja; no se modifica. Una identidad registrada impide cambiar su fabricante u hogar mediante una actualización del dispositivo.

| Rol técnico nuevo | Permiso concedido |
| --- | --- |
| `smarthome_mqtt_registrar` | Solo ejecutar el registro de una identidad ya provisionada y verificada por el futuro orquestador. |
| `smarthome_mqtt_revoke` | Solo reclamar y finalizar tareas de revocación. No puede registrar identidades. |

Ambos son NOLOGIN/NOBYPASSRLS; no se crean cuentas ni contraseñas de despliegue. Las cuentas futuras deben tener únicamente su rol previsto y pasar la auditoría de privilegios. El rol API, ingesta, worker general y readonly no reciben ejecución administrativa ni acceso directo a la tabla. La tabla tiene RLS habilitado sin políticas de acceso directo; las funciones SECURITY DEFINER fijan `search_path` y revocan ejecución a PUBLIC.

`fn_register_mqtt_identity` valida un dispositivo MQTT activo, hogar activo y coincidencia del fabricante, y bloquea la fila del dispositivo para serializarse con su baja. Repetir el mismo registro es idempotente mientras siga `REGISTERED`; otra identidad se rechaza. `REVOKE_PENDING` y `REVOKED` son terminales para registro, incluso si alguien restaura la fila del dispositivo.

**El registro no comprueba posesión, no reserva el fabricante antes del alta y no crea credenciales.** Solo incorpora metadatos de una identidad previamente verificada. No hay backfill automático: no se conocen identidades individuales para dispositivos que usan credenciales globales. No debe llamarse después de provisionar sin diseñar la compensación si el registro falla; esa orquestación sigue pendiente.

## Recuperación y concurrencia

- Cada reclamo utiliza `FOR UPDATE SKIP LOCKED`, token aleatorio y lease fijo de 60 segundos. No mantiene una transacción SQL abierta durante MQTT.
- Solo el token vigente, antes de expirar, puede finalizar la tarea. Una confirmación antigua devuelve `LEASE_LOST` y no modifica el estado.
- Los errores administrativos dejan la tarea pendiente: reintentos a 5, 10, 20, 40, 80, 160 y como máximo 300 segundos. Se repite únicamente `disableClient`, que no habilita ni rota credenciales.
- Una caída del proceso o fallo de BD tras el ACK deja el lease recuperable. El siguiente intento puede deshabilitar de nuevo la misma identidad y confirmar el resultado.
- Un cliente inexistente en el broker produce rechazo y permanece pendiente. No se confunde rechazo con revocación confirmada; requiere reconciliación operativa.
- Solo se persisten códigos permitidos. Fallos inesperados usan `MQTT_REVOCATION_UNEXPECTED`; los fallos del repositorio se exponen como `MQTT_REVOCATION_STORE_UNAVAILABLE`, sin texto SQL, conexión o payload del broker.

## Validación ejecutada

La ejecución usa exclusivamente contenedores nuevos, puertos aleatorios en loopback, almacenamiento temporal y credenciales aleatorias. No lee `.env` ni se conecta a la base, broker o Shelly del proyecto.

- 207 pruebas unitarias: 195 anteriores y 12 del trabajador.
- 40 pruebas nuevas con PostgreSQL real y Mosquitto TLS, además de las 28 pruebas de broker del primer incremento: 68 en la ejecución coordinada.
- Liquibase 4.29: validate, migración limpia, rollback de registro vacío y reaplicación; actualización incremental de 62 a 63 changesets con checksums previos intactos y dispositivo preexistente conservado.
- Conexiones de prueba reales sin SUPERUSER/BYPASSRLS ni membresía administrativa; rechazo de administración desde API/ingesta y separación registrar/revocador.
- OWNER puede dar de baja; MEMBER, GUEST y OWNER de otro hogar no crean revocaciones. La suite comprueba rollback conjunto, bloqueos entre registro/baja, reclamos concurrentes y tokens vencidos.
- Baja → tarea → `disableClient` real → cierre de conexión → rechazo de reconexión. Otra prueba reproduce ACK del broker seguido de caída de escritura en BD y recuperación por lease.
- Comparación del contenido antes/después de consumo crudo, agregados, telemetría, alertas, notificaciones y auditoría del dispositivo: sin cambios.
- Compilación Nest, TypeScript, ESLint de los cuatro archivos TS nuevos y validación/generación Prisma aprobadas. Sintaxis Node de los scripts comprobada.

Reproducir desde el backend, con las revisiones coordinadas:

```powershell
node scripts/test-mqtt-revocation.cjs ../hu11-database
```

Requiere dependencias del backend, Docker, OpenSSL e imágenes locales `postgres:16-alpine`, `liquibase/liquibase:4.29` y `eclipse-mosquitto:2.0.22`. El harness no descarga imágenes. Retira exclusivamente sus contenedores y certificados al finalizar. Las imágenes permanecen en caché.

## Activación y pendientes

El trabajador no está registrado en Nest ni tiene scheduler. La prueba lo construye y ejecuta explícitamente. La migración solo se aplicó a bases desechables. En un despliegue, el trigger empezaría a registrar tareas al aplicar el changeset, pero procesarlas requerirá configurar el pool y supervisor técnicos, el broker administrativo y la observabilidad de pendientes. Tras un fallo que cierre el transporte administrativo, el supervisor deberá construir una conexión nueva; HU11 no reconecta ni reenvía comandos inciertos automáticamente.

Antes del alta cloud faltan reserva previa a emisión, autorización/posesión, entrega segura del secreto, serialización de emisión/rotación con revocación, reconciliación y auditoría completa de intentos. La recuperación en la misma casa debe emitir la identidad apropiada tras posesión; este incremento no reactiva una identidad revocada. No habilitar `rotate` del adaptador anterior sobre referencias pendientes/revocadas.

El rollback rechaza cualquier registro no vacío para evitar perder referencias o tareas, incluso si todas están revocadas. En una instalación con datos se requiere una corrección hacia adelante; no borrar el registro para forzar rollback. Los roles NOLOGIN se conservan al revertir una instalación vacía, sin las funciones ni privilegios de tabla de este incremento.

HU13 permanece intacta en sus copias originales; HU16 todavía requiere integración, incluyendo sus correcciones de consumo/RLS. Estos resultados no prueban Shelly físico, pairing móvil ni producción cloud.

## Fuentes técnicas

- [PostgreSQL 16: bloqueo de filas y SKIP LOCKED](https://www.postgresql.org/docs/16/sql-select.html#SQL-FOR-UPDATE-SHARE).
- [PostgreSQL 16: funciones SECURITY DEFINER y permisos](https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).
- [Evidencia anterior del adaptador y broker](HU11_MQTT_IDENTITIES.md).
