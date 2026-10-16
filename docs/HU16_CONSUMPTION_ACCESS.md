# HU16 — Permisos de consumo, históricos y aislamiento real

**Fecha:** 14/10/2026. **Rama:** `16-dev` en backend y BD. **Referencias:** BD-03, BD-04, BD-05; evidencia adicional para BD-17 de HU09.

GUEST recibe únicamente el total de energía del hogar y el período consultado, conforme a la decisión de la responsable en esta conversación. OWNER y MEMBER conservan detalle, estadísticas e históricos, incluidos dispositivos desactivados o retirados. Los usuarios sin membresía vigente no acceden al consumo de otro hogar.

La rama backend parte de `09-dev` / `6b033fe`; BD parte de `09-dev` / `3e6e4b9`. Esta dependencia conserva los avances de familias de sesión. No se integraron cambios en `main`, `dev` ni en las ramas `09-dev`.

## Contrato HTTP

| Ruta bajo `/api/v1/homes/:homeId` | OWNER / MEMBER | GUEST |
|---|---|---|
| `/consumption/summary` | Resumen completo anterior. | Solo `homeId`, `from`, `to`, `totalEnergyDeltaKwh`. |
| `/consumption` | Lecturas con metadata histórica autorizada. | `403`, `CONSUMPTION_DETAIL_FORBIDDEN`. |
| `/consumption/daily` | Series diarias. | `403`. |
| `/devices/:deviceId/consumption` | Lecturas históricas del dispositivo. | `403`. |
| `/devices/:deviceId/consumption/summary` | Estadísticas históricas del dispositivo. | `403`. |
| `/devices/:deviceId/consumption/daily` | Series diarias del dispositivo. | `403`. |

Ejemplo GUEST para un período solicitado:

```json
{
  "homeId": "20000000-0000-4000-8000-000000000001",
  "from": "2026-10-11T00:00:00.000Z",
  "to": "2026-10-11T23:59:59.000Z",
  "totalEnergyDeltaKwh": 0.6
}
```

El resumen básico no incluye potencia, máximos/mínimos, número de lecturas o dispositivos, última lectura, identificadores de dispositivo ni series diarias. Sin límites de fecha, `from`/`to` son nulos y el total cubre los registros disponibles. Los límites de fecha conservan la inclusión de ambos extremos; se mantienen la validación ISO y el rechazo de rangos invertidos.

Invitados pendientes, membresías revocadas o terminadas, usuarios ajenos y el antiguo creador sin membresía reciben `403`; una cuenta inactiva recibe `401` por el guard JWT real. Un dispositivo de otro hogar devuelve `404` después de autorizar el hogar de la ruta. El rol global del JWT no sustituye la membresía.

Se conserva la regla histórica existente para hogares inactivos: OWNER puede consultar sus históricos y MEMBER no. No se añade un flujo de desactivación de hogares.

## Históricos y RLS

La autorización detallada se centraliza en `consumption.fn_can_read_detail`, compartida por API y políticas SELECT de lecturas y métricas. GUEST pierde SELECT directo sobre esas tablas; su total se calcula mediante `fn_basic_home_consumption`, una función SECURITY DEFINER con comprobación explícita de cuenta/membresía y hogar activo.

`fn_history_devices` devuelve únicamente ID, nombre e identificador de fabricante de dispositivos del hogar autorizado y solicitados por ID. Permite resolver metadata histórica sin ampliar las políticas normales de dispositivos. Los casos de uso ya no exigen dispositivo ACTIVE para leer históricos; tampoco dependen del JOIN de metadata que RLS ocultaba para MEMBER tras la baja.

Las tres funciones fijan `search_path`, usan nombres de esquema explícitos y revocan EXECUTE a PUBLIC. El backend usa parámetros enlazados y contexto de usuario local a la transacción. Las políticas de control, modificación e ingesta no se amplían. Una lectura histórica no reactiva el dispositivo ni publica comandos MQTT.

## Dependencia de esquema encontrada al ejecutar Liquibase

La primera prueba desde cero mostró que los 62 changesets originales no creaban `auth.refresh_token` ni `auth.user.session_version`, aunque Prisma los esperaba y las fixtures de HU09 los proporcionaban. Las afirmaciones anteriores de compatibilidad de familias describían ese contrato de Prisma y las pruebas sintéticas; no acreditaban la creación desde el historial instalado.

Se prepararon dos changesets adicionales, sin editar SQL ya versionado en changesets anteriores:

1. `hu09-session-schema-bridge-20261014`: añade los objetos de sesión faltantes, índices y permisos de columnas necesarios. Conserva objetos compatibles preexistentes y valida columnas y claves básicas; un esquema divergente debe reconciliarse antes de aplicar. Su rollback conserva intencionalmente tabla, datos, columna y grants: no es una eliminación del esquema de sesiones.
2. `hu16-consumption-detail-access-20261014`: agrega las funciones de consumo y restringe las políticas SELECT de lecturas y métricas.

El nuevo backend requiere ambos changesets. El rollback de consumo restaura las reglas anteriores, incluido SELECT detallado para GUEST: es un retroceso de seguridad y necesita revisión junto con la versión de backend. La prueba automatizada lo ejecuta únicamente en su contenedor desechable.

## Evidencia del incremento

| Validación | Resultado |
|---|---|
| Pruebas unitarias existentes | 82 aprobadas en 5 suites. |
| HTTP + JWT + Prisma + RLS + Socket.IO reales | 28 casos aprobados en PostgreSQL 16. |
| Liquibase 4.29.2 desde cero | 62 changesets originales + puente de sesiones + consumo: 64 aplicados. |
| Camino incremental | Primer update excluye HU16; el segundo aplica el changeset de consumo sobre los 63 anteriores. |
| Preservación de datos | Huellas de lecturas y refresh sin cambios al repetir el puente sobre esquema compatible y tras rollback/reaplicación de consumo. |
| Compilación, TypeScript y ESLint de archivos cambiados | Aprobados. |

La suite utiliza un LOGIN PostgreSQL real, `consumption_app_test`, que hereda `smarthome_app`. Comprueba ausencia de superusuario, BYPASSRLS, membresías elevadas y pertenencia a propietarios de tablas. No sustituye el guard JWT, repositorios de usuarios/refresh, consultas de consumo, RLS ni autorización realtime. Los JWT están firmados para cuentas sintéticas; no se prueba el ingreso de contraseña ni Argon2 en esta suite.

Se prueban OWNER/MEMBER/GUEST, pendientes/revocados/terminados, hogares ajenos, cuenta inactiva, creador sin membresía, dispositivo cruzado, históricos retirados, unidades W/kWh conocidas, filtros/límites y revocación de membresía. Los accesos SQL directos confirman el aislamiento de lecturas y métricas y la restricción de metadata. El pool tiene una sola conexión física; tras alternar usuarios y terminar transacciones exitosas o fallidas, se comprueba que no queda contexto y un SELECT sin contexto no ve filas.

La suite no envía tráfico MQTT ni usa Shelly, push o cuentas reales. Una modificación concurrente después de una lectura de permisos o un paquete ya enviado no se pueden retirar; estas pruebas comprueban cambios visibles tras el commit de revocación.

## Reproducción e integración

Con dependencias y cliente Prisma generados, Docker y el repositorio BD de `16-dev`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-consumption-access.ps1
```

Si BD está en otra carpeta, pasar `-DatabaseRepository 'ruta-del-repositorio-BD'`. El script crea una red dedicada y PostgreSQL temporales, publica un puerto aleatorio solo en `127.0.0.1`, usa contraseñas sintéticas y monta las fuentes de BD de solo lectura. Ejecuta Liquibase sin cargar las propiedades locales de conexión. Restaura la variable de prueba y elimina únicamente sus contenedores/red. No modifica servicios ni volúmenes existentes. `-MigrationOnly` omite la fixture y las 28 pruebas; no acredita la matriz de permisos.

Antes de aplicar en una instalación existente se debe comparar su historial/checksums, objetos de sesión y propietario de las funciones. El backend y la BD deben integrarse de forma coordinada. Este incremento acredita el escenario desechable, no la equivalencia con un snapshot o una instalación anterior.

BD-04/BD-05 no se declaran cerrados en su totalidad: faltan otras rutas de permisos/control, integración de web/móvil, duplicados/reinicio/orden de telemetría y validación operativa. BD-17 conserva pendientes de WSS, carga y coordinación entre réplicas. No hubo despliegue ni migración sobre una base en uso.
