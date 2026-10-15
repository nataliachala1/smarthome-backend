# HU09 / BD-17 — Seguridad de sesiones y eventos Socket.IO

**Fecha:** 14/10/2026. **Rama:** `09-dev`. **Estado:** tercer incremento de HU09; aceptación integral de BD-17 pendiente.

**Actualización:** el [cuarto incremento](HU09_SESSION_FAMILIES.md) añade `sid` obligatorio, revocación individual y pruebas de familias persistidas en PostgreSQL. Los resultados de este documento corresponden al tercer incremento.

El namespace `/realtime` ahora comprueba el usuario activo, la versión de sesión y la expiración del JWT al conectar y antes de entregar eventos. `logout-all` desconecta las sesiones anteriores del usuario en el mismo proceso. Los eventos con detalles de hogar requieren una membresía OWNER o MEMBER vigente; los destinatarios calculados previamente por el publicador ya no bastan para autorizar su entrega.

## Comportamiento implementado

- Autenticación en middleware del namespace, antes de completar la conexión. Se comprueban firma HS256, `sub` UUID, `role`, `sv` entero no negativo y `exp`. El rol global debe coincidir con el usuario actual; no sustituye el rol del hogar.
- Segunda comprobación al registrar el socket, con seguimiento de conexiones pendientes para impedir que una respuesta tardía reactive una sesión revocada localmente.
- Temporizador de expiración por conexión y revisión de cuentas con una cadencia de 15 segundos. Esta cadencia no es un plazo máximo de desconexión: depende del tiempo de las consultas y del event loop.
- Consulta de la cuenta antes de cada entrega. Si falla, se suprime el evento y se desconecta la sesión afectada. Un fallo en la consulta de membresía suprime el evento de hogar.
- `logout-all` publica una revocación local inmediatamente después de incrementar `session_version`, antes de revocar refresh tokens. Si esta última operación falla, los sockets anteriores permanecen desconectados. No afecta a otros usuarios ni a sesiones con una versión posterior.
- Los clientes no tienen operaciones para elegir o unirse a rooms. La identidad del JWT determina su room `user:<UUID>` y los eventos se entregan a sockets individualmente autorizados.
- Se utiliza la lista de orígenes validada de HTTP. `SecureIoAdapter` aplica CORS y `allowRequest` para rechazar orígenes ajenos en polling y WebSocket. Los clientes nativos sin `Origin` siguen requiriendo JWT.

La comprobación adicional de origen es necesaria porque CORS no restringe por sí solo el transporte WebSocket. Véase [Socket.IO y CORS](https://socket.io/docs/v4/handling-cors/). La autenticación inicial usa el [middleware de Socket.IO](https://socket.io/docs/v4/middlewares/), que se ejecuta una vez por conexión; las comprobaciones posteriores pertenecen al servicio de sesiones implementado aquí.

## Matriz de entrega de este incremento

Esta matriz aplica exclusivamente a los eventos existentes. No cierra la matriz completa API/BD de BD-04.

| Evento | Condición adicional a la sesión válida |
|---|---|
| `consumption.created` | OWNER o MEMBER activo, invitación aceptada, membresía sin fecha de fin, hogar activo y sin borrado lógico. |
| `device.status.updated` | Misma condición: el payload contiene potencia y estado detallado del dispositivo. |
| `notification.created` con hogar | Mismas condiciones de membresía y `userId` del payload igual al destinatario. |
| `notification.created` personal | Destinatario coincidente y `homeId` y `deviceId` explícitamente nulos. |
| `notification.unread_count.updated` | Sesión del destinatario válida y contador entero no negativo. |
| Evento desconocido o payload sin los campos necesarios | Entrega denegada. |

GUEST conserva los eventos personales permitidos, pero no recibe detalles de consumo, dispositivo o notificación de hogar. El payload de resumen básico GUEST sigue pendiente de definición e implementación; este incremento no inventa uno ni corrige los endpoints HTTP de consumo de BD-05.

La membresía se consulta mediante `PrismaRlsService.withUserContext`, usando el UUID del destinatario. La autorización no se infiere de `created_by`, de la lista inicial de destinatarios MQTT ni del rol global del JWT.

## Contrato para web y móvil

Se conservan `/realtime`, `auth.token`, el encabezado `Authorization: Bearer ...` y el evento `realtime.connected` con `{ userId }`. No se aceptan tokens en la URL.

Una conexión rechazada por autenticación emite `connect_error`; `error.data.code` contiene el motivo estable. Una conexión ya establecida puede recibir `realtime.error` antes de desconectarse:

| Código | Interpretación |
|---|---|
| `REALTIME_UNAUTHORIZED` | Token ausente, inválido o con claims incompatibles al conectar. Incluye tokens ya expirados en el handshake. |
| `REALTIME_TOKEN_EXPIRED` | La sesión comprobada alcanzó la expiración de su access token. |
| `REALTIME_SESSION_REVOKED` | Cuenta inexistente/inactiva, cambio de rol global o versión de sesión diferente. |
| `REALTIME_UNAVAILABLE` | No se pudo comprobar la sesión. |

El rechazo de origen ocurre en el transporte y puede producir un `connect_error` genérico, sin esos códigos. No se envían al cliente errores de BD, tokens ni mensajes internos de verificación criptográfica.

La renovación se realiza mediante una nueva conexión autenticada. Cambiar `socket.auth` sobre una conexión activa no renueva su identidad. El cliente debe obtener un access token vigente a través del flujo HTTP de refresh y reconectar:

```typescript
// Ejecutar desde el flujo de sesión del cliente, con exclusión de refresh simultáneos.
socket.disconnect();
const accessToken = await refreshSessionOverHttp();
socket.auth = { token: accessToken };
socket.connect();
```

`refreshSessionOverHttp` representa la integración HTTP del cliente; no es una función nueva del backend. Si el refresh está revocado, debe finalizar la sesión. Una desconexión iniciada por el servidor requiere reconexión explícita del cliente. Tras reconectar, consultar de nuevo los datos autorizados por HTTP: el canal conserva entrega de mejor esfuerzo y no reproduce eventos perdidos.

## Evidencia de pruebas

| Validación | Resultado |
|---|---|
| Suite unitaria existente del backend | 82 pruebas aprobadas. |
| Integración Socket.IO con JWT firmados y clientes reales en loopback | 43 casos aprobados. |
| Concurrencia de sesiones con consultas controladas | 5 casos aprobados. |
| Resolución de dependencias del módulo Realtime real | 1 caso aprobado, con contratos externos sustituidos. |
| Regresión HTTP de límites de solicitudes | 17 casos aprobados. |
| Compilación, TypeScript y ESLint de archivos cambiados | Aprobados. |

Los casos cubren polling/WebSocket, orígenes ajenos, clientes nativos, tokens inválidos, cuentas inactivas, rooms ajenas, roles de hogar, cambios de membresía tras conectar, `logout-all`, fallo posterior de revocación de refresh, expiración de un socket inactivo, reconexión y consultas fallidas. Las pruebas de concurrencia retrasan deliberadamente lecturas de cuenta para comprobar que una revocación o desconexión local no se deshace al terminar esas lecturas.

Los repositorios de usuario, membresía y refresh son fixtures. Los JWT y el transporte son reales; PostgreSQL, RLS, SMTP, MQTT y Shelly no participan. La prueba de `logout-all` ejecuta el caso de uso real, no el recorrido HTTP completo de autenticación. Los resultados no acreditan políticas instaladas ni una prueba de producción.

```powershell
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/realtime-security.e2e-spec.ts test/realtime-session-races.e2e-spec.ts test/realtime-module.e2e-spec.ts test/rate-limit.e2e-spec.ts
npm.cmd run build
.\node_modules\.bin\tsc.cmd --noEmit
```

La primera ejecución detectó que el fixture de JWT sin expiración pasaba `exp: undefined` al firmador, que lo rechazaba antes de probar el gateway. Se corrigió omitiendo el claim. También se corrigió el tipo del servidor HTTP de la prueba para completar la verificación TypeScript.

## Compatibilidad y pendientes

No hay nuevas dependencias, migraciones ni cambios en tablas. Se reutilizan `user.session_version`, el estado del usuario, `home_member` y `home`, presentes en la versión funcional de BD `f097a0a`. Los publicadores MQTT y de notificaciones conservan su interfaz de mejor esfuerzo; la autorización ocurre antes de enviar.

BD-17 permanece abierto por estas condiciones:

- Validar API, RLS y realtime con usuarios reales de prueba y conexiones sin privilegios elevados. Los filtros de este incremento no certifican la instalación de BD-03/BD-04.
- Validar WSS, proxy y renovación con web y móvil en staging. La prueba local usa HTTP en loopback.
- Resolver revocación y distribución de eventos entre réplicas. El aviso inmediato de `logout-all` y el registro de sockets son locales al proceso; las otras instancias dependen de sus consultas de cuenta.
- La revocación individual se implementó en el cuarto incremento enlazado arriba: HTTP y Socket.IO exigen `sid` y familia activa. Su integración con clientes y la notificación inmediata entre instancias siguen pendientes de validar.
- Las consultas de cuenta y membresía no son atómicas con la entrega de red. Se filtran los cambios visibles en esas lecturas; una modificación concurrente posterior a la lectura o un paquete ya enviado no puede retirarse. Las pruebas de concurrencia cubren la revocación local de sesión, no una garantía transaccional distribuida para cambios de membresía.
- Medir la carga de consultas por evento y establecer protección de conexiones Socket.IO. Los límites HTTP anteriores no limitan handshakes ni eventos de este transporte.

No se aplicaron migraciones ni se intervinieron servicios en uso, broker o Shelly.
