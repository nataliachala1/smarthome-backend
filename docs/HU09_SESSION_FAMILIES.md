# HU09 / BD-17 — Logout individual y familias de sesión

**Fecha:** 14/10/2026. **Rama:** `09-dev`. **Estado:** cuarto incremento implementado y probado; HU09 continúa abierta.

**Evidencia posterior HU16:** la prueba del historial Liquibase original desde cero detectó que faltaban los objetos de sesión que las fixtures de este incremento creaban. El [incremento HU16](HU16_CONSUMPTION_ACCESS.md) agrega un changeset de compatibilidad y verifica el historial completo con un LOGIN sujeto a RLS. La compatibilidad indicada aquí describe el contrato Prisma/fixture; no prueba que esos objetos estuvieran creados por los changesets originales o en una instalación real.

Cerrar sesión ahora revoca su familia de refresh tokens, invalida sus access tokens para solicitudes HTTP posteriores y desconecta sus sockets del mismo proceso. Otro login del mismo usuario conserva su propia familia. Se utiliza `auth.refresh_token.family_id`, ya existente; no se requiere una migración de esquema.

## Contrato de autenticación

Los access tokens de login incluyen `sid`, el UUID de la familia nueva para ese login. Refresh conserva el mismo `sid`. Este identificador no es un secreto ni reemplaza el JWT firmado.

HTTP y Socket.IO comprueban firma HS256, identidad, rol global, versión de sesión y existencia de un refresh no revocado ni expirado de esa familia, usuario y versión. HTTP comprueba de nuevo la expiración tras sus consultas.

**Cambio de compatibilidad:** los access tokens anteriores sin `sid` se rechazan. Un refresh vigente del esquema existente permite obtener un access token con `sid`; si no puede renovarse, el cliente debe pedir login. Las respuestas JSON, rutas y cookie de refresh conservan su formato y el cliente sigue tratando el JWT como opaco.

| Operación | Resultado |
|---|---|
| Login | Persiste un refresh con familia nueva antes de emitir el access token vinculado. |
| Refresh correcto | Reemplaza el refresh atómicamente y conserva la familia. Los access tokens aún vigentes de esa familia siguen autorizados. |
| Logout con cookie conocida | Revoca la familia y avisa a sus sockets locales. También acepta una cookie antigua rotada que aún figure en el historial. |
| Logout sin cookie o con cookie desconocida | Conserva su comportamiento idempotente; no identifica otra sesión para revocar. |
| Reutilización de refresh reemplazado | Rechaza el refresh, revoca su familia y desconecta sus sockets locales. |
| Logout-all | Conserva la revocación global por `session_version` y de refresh tokens. |

Tras el commit de revocación, las solicitudes posteriores de esa familia reciben `401`. El aviso local se emite antes de responder al logout. Un paquete ya enviado o una solicitud ya autorizada no puede retirarse. El cliente debe cerrar también su socket local.

## Rotación y logout concurrentes

La rotación anterior creaba el sucesor y revocaba el anterior en operaciones separadas. `PrismaRefreshTokenRepository.rotate` ahora comprueba el predecesor, crea el sucesor y revoca/actualiza el anterior dentro de una transacción. Rotación y revocación adquieren el mismo advisory lock transaccional por familia y fijan explícitamente `ReadCommitted`, para leer los cambios confirmados tras esperar el lock.

- Si logout obtiene primero el lock, la rotación posterior no crea un sucesor.
- Si la rotación obtiene primero el lock, logout revoca también el sucesor confirmado.
- Si falla la inserción, la transacción no revoca el predecesor.
- Dos renovaciones del mismo refresh permiten una sola rotación. La segunda se trata como reutilización y revoca la familia, incluso si la primera ya respondió satisfactoriamente.

Los clientes deben coordinar el refresh entre solicitudes y pestañas que comparten cookie. Después de detectar reutilización, deben restablecer la sesión; no reintentar indefinidamente el token anterior.

Los locks coordinan conexiones con esta implementación y la misma BD. Un despliegue mixto con versiones antiguas que omitan el lock no ofrece esta garantía. Referencias: [locks de PostgreSQL](https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS) y [transacciones Prisma](https://www.prisma.io/docs/orm/fundamentals/transactions).

## Sockets y varias instancias

Cada socket conserva `sessionId`. El aviso individual corta solo los sockets del usuario y familia coincidentes, incluidas conexiones pendientes de consulta. Se conserva la revocación global por versión.

La familia se consulta antes de cada entrega y durante la revisión periódica. Los sockets de una familia comparten esa consulta dentro de una revisión por usuario. Un fallo de consulta deniega la entrega y desconecta los sockets afectados por esa revisión; no se mantiene una lista ilimitada de familias revocadas en memoria.

Una revocación desde otro proceso se detecta mediante BD antes de la próxima entrega o en la revisión periódica. El aviso inmediato sigue siendo local: no hay bus distribuido ni plazo máximo certificado entre réplicas. Continúan los límites entre lectura de membresía y envío descritos en el [incremento anterior](HU09_REALTIME_SECURITY.md).

## Pruebas realizadas

| Grupo | Resultado y alcance |
|---|---|
| Unitarias del backend | 82 aprobadas en 5 suites. |
| Regresión HTTP/Socket.IO y concurrencia aislada | 68 aprobadas en 4 suites; repositorios sustituidos según el fixture. |
| Persistencia y concurrencia con Prisma/PostgreSQL 16 reales | 8 aprobadas. |
| HTTP, JWT y Socket.IO con familias persistidas | 9 aprobadas. |
| Compilación, TypeScript y ESLint de archivos cambiados | Aprobados. |

Las ocho pruebas de persistencia comprueban rotación, competencia entre renovaciones, logout/rotación en ambos órdenes con esperas observadas en `pg_locks`, rollback, predecesores inválidos, vínculo usuario/versión y aislamiento entre familias. Las nueve de flujo comprueban dos logins del mismo usuario, varios sockets por familia, refresh, logout con cookie rotada, reutilización, claims ausentes/inválidos, revocación sin aviso local y logout anónimo. Las pruebas de concurrencia en memoria también cubren revocación individual con consulta de familia pendiente.

El PostgreSQL desechable usa `Repeatable Read` por defecto para comprobar que el repositorio fija su propio aislamiento. Tiene nombre único, datos en memoria, contraseña sintética y puerto aleatorio solo en `127.0.0.1`. El script crea y elimina ese contenedor, restaura la variable de conexión de prueba y no usa bases o volúmenes existentes.

Se ejecutan controladores, casos de uso de sesión, guard JWT, firmador, hashing de refresh, repositorio Prisma y transporte reales. Búsqueda de usuarios, verificación de contraseña y permisos de hogar del flujo integrado son fixtures. El LOGIN de prueba no representa uno de mínimo privilegio. No se certifican Argon2, RLS, membresías ni el historial Liquibase instalado.

Requisitos: dependencias y cliente Prisma generados, Docker y repositorio BD con `scripts/session-security-fixture.sql`. Desde la raíz del backend:

```powershell
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/realtime-security.e2e-spec.ts test/realtime-session-races.e2e-spec.ts test/realtime-module.e2e-spec.ts test/rate-limit.e2e-spec.ts
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-session-security.ps1
npm.cmd run build
.\node_modules\.bin\tsc.cmd --noEmit
```

Si BD está en otra carpeta, pasar `-DatabaseRepository 'ruta-del-repositorio-BD'` al script. Las suites PostgreSQL se omiten si falta `SESSION_TEST_DATABASE_URL`; ejecutar solo Jest sin el script no acredita esos 17 casos. La fixture exige una base llamada `smarthome_session_test`, crea solo tablas sintéticas necesarias y no está incluida en Liquibase.

## Integración pendiente

No cambian Prisma, el lockfile ni el esquema instalado. BD incorpora la fixture y su documentación sobre las columnas de la versión funcional `f097a0a`. La integración debe coordinar el backend completo por el nuevo `sid` obligatorio y el protocolo de locks.

Antes del despliegue faltan LOGIN de mínimo privilegio, esquema/migraciones reales, usuarios de hogares distintos, clientes web/móvil, proxy/WSS y carga. Debe medirse el coste de la consulta de familia por solicitud o entrega. La distribución inmediata de avisos entre instancias sigue pendiente.

No se modificaron bases en uso, broker, Shelly ni servicios de producción. HU09 y BD-17 permanecen abiertos por esas verificaciones.
