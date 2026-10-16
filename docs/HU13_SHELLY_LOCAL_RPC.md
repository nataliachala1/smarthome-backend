# HU13 / BD-16 — Validación RPC y acceso local a Shelly

**Fecha:** 15/10/2026. **Rama:** `13-dev`, creada desde backend `09-dev` / `6b033fe`. BD prepara documentación en `13-dev` desde `09-dev` / `3e6e4b9`. Incremento implementado localmente, pendiente de commit/push conforme al paso de revisión solicitado.

## Comportamiento

`MQTT.SetConfig` debe devolver un objeto con `restart_required` booleano. JSON nulo, vacío, inválido, arrays, escalares, objetos incompletos o envoltorios de otro transporte se rechazan con `502 / SHELLY_INVALID_RESPONSE`. Un error RPC dentro de HTTP exitoso produce `SHELLY_RPC_ERROR`.

El aprovisionamiento fija `ssl_ca: "ca.pem"`: Shelly define `ssl_ca=null` como TCP sin TLS, por lo que no se permite una degradación silenciosa. Configurar el broker del Shelly como `host:8883` y validar en hardware que la CA integrada del firmware confíe en la cadena real del broker. CAs privadas requieren cargarse al equipo como `user_ca.pem`; ese flujo no está implementado. [Configuración MQTT oficial](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Mqtt/).

`Shelly.Reboot` acepta JSON `null`. Solo ese método mantiene la compatibilidad previa con cuerpo vacío; otros resultados se rechazan. Una respuesta de configuración inválida detiene el flujo antes de reiniciar y antes de crear el registro en BD. **No revierte una configuración que el dispositivo ya haya aplicado:** reconciliación e idempotencia de provisioning siguen en BD-11.

El timeout de tres segundos abarca petición y lectura del cuerpo, usa AbortController y limpia el temporizador. Los errores entregan códigos y mensajes fijos, sin cuerpo de respuesta, IP, contraseñas ni excepción original. Se conservan las IPv4 privadas y el rechazo de redirecciones; una dirección privada no demuestra pertenencia a la red del hogar.

La identificación valida los campos usados, generación entera positiva y `auth_en` booleano obligatorio. Un valor ausente o mal formado no se interpreta como autenticación deshabilitada. Falta contrastar el contrato con el firmware del único equipo físico; no se intervino el Shelly.

## Activación explícita del modo local

`SHELLY_LOCAL_ENABLED` acepta las cadenas `true` o `false` (con espacios externos opcionales). Ausente significa deshabilitado, también en desarrollo. Una instalación local de diagnóstico autorizada requiere `SHELLY_LOCAL_ENABLED=true`; este incremento no modifica el entorno existente.

Con `NODE_ENV=production` no puede habilitarse: la validación de arranque lo rechaza. El guard y los servicios también deniegan acceso si se omite esa validación. No sustituye la segmentación de red ni convierte el flujo en pairing cloud.

Las tres rutas `/api/v1/homes/:homeId/shelly` (`discover`, `identify`, `provision`) conservan JWT y autorización OWNER. Tras autenticar, el guard devuelve `403 / SHELLY_LOCAL_DISABLED` antes del caso de uso cuando el modo está deshabilitado. RPC y discovery comprueban también la política antes de contactar la LAN. No cambia el control MQTT ordinario de dispositivos ya registrados.

## Contrato para clientes

`identify` mantiene `mqttConnected: boolean | null` y agrega `mqttStatusErrorCode: string | null`. Una consulta MQTT fallida conserva la identificación y devuelve `mqttConnected=null` con motivo estable. Una consulta válida devuelve `true` o `false` y código nulo. Los equipos con autenticación local no se sondean por MQTT y este flujo de provisioning los rechaza.

Se conserva el HTTP 201 de `POST /identify` y se corrige su documentación Swagger para reflejarlo; no se cambia el estado HTTP de la ruta.

| Código | Resultado |
|---|---|
| `SHELLY_LOCAL_DISABLED` | 403; diagnóstico/aprovisionamiento local deshabilitado. |
| `SHELLY_INVALID_IP` | 400; objetivo no admitido. |
| `SHELLY_INVALID_DEVICE` | 422; identificación incompleta o con tipos inválidos. |
| `SHELLY_UNSUPPORTED_DEVICE` | 422; modelo/generación no soportados. |
| `SHELLY_RPC_TIMEOUT` | 502; timeout de petición o lectura del cuerpo. |
| `SHELLY_UNREACHABLE` | 502; fallo de transporte. |
| `SHELLY_HTTP_ERROR` | 502; respuesta HTTP no exitosa distinta de 401/403. |
| `SHELLY_AUTH_REQUIRED` | Diagnóstico MQTT para 401/403; 502 en RPC obligatorio, o 422 al rechazar provisioning con `auth_en=true`. |
| `SHELLY_INVALID_RESPONSE` | 502; JSON o esquema inesperado. |
| `SHELLY_RPC_ERROR` | 502; respuesta RPC de error. |
| `SHELLY_MQTT_NOT_CONNECTED` | 502; espera agotada con última consulta válida que informa desconexión. |

Los fallos de la consulta opcional MQTT aparecen en `mqttStatusErrorCode`, sin convertir por sí solos la identificación en error HTTP. La espera conserva hasta doce intentos, pausa inicial de dos segundos e intervalos de 1,5 segundos; si la última consulta falla, conserva su código. Un fallo transitorio puede recuperarse en un intento posterior. El modo local usa las credenciales MQTT configuradas en el backend y no crea identidades individuales: esto sigue siendo una POC de LAN, no el pairing productivo multiusuario.

## Validación realizada

- 93 pruebas unitarias aprobadas: 82 anteriores y 11 nuevas de configuración local.
- 62 casos sintéticos RPC/HTTP aprobados: bloqueo de endpoints y llamadas directas, TLS verificado configurado, respuestas inválidas, auth, timers, reintentos y ausencia de creación/reinicio tras SetConfig inválido.
- Compilación NestJS, TypeScript sin emisión y ESLint de archivos cambiados aprobados.

La suite `test/shelly-local-security.e2e-spec.ts` usa controladores, casos de uso, validadores y guard local reales. Sustituye JWT, contexto RLS y persistencia con fixtures. `fetch` está simulado y Bonjour no permite contactar mDNS; HTTP de prueba usa loopback. No certifica JWT/RLS, hardware, identidad individual, TLS ni pairing cloud. La primera ejecución encontró una carrera del servidor temporal en tres casos; se corrigió su creación secuencial. La ejecución final aprobó los 62 casos.

Comandos utilizados con dependencias existentes:

```powershell
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/shelly-local-security.e2e-spec.ts
npm.cmd run build
.\node_modules\.bin\tsc.cmd --noEmit
```

## Integración y límites

No cambia Prisma, dependencias, lockfile, esquema, roles ni policies. BD documenta compatibilidad; no se crea un changeset vacío. Las pruebas no ejecutan migraciones ni acceden a una BD instalada.

Esta rama parte de `09-dev`: no incorpora automáticamente consumo/históricos de `16-dev` ni su puente de sesiones. La integración final debe conservar backend `bc9d3ec`, BD `07de82f` y `c23c7f3`, y comparar el historial instalado. No desplegar `13-dev` como sustitución del trabajo HU16.

HU13 sigue abierta por firmware/hardware autorizado, control fuera de LAN, confirmación física y recuperación. BD-11 mantiene pendiente el fallo parcial tras configuración física. El informe de auditoría anterior y el archivo de revisión de BD quedan fuera de este incremento.

## Referencias de protocolo

La forma directa de SetConfig/GetStatus se contrastó con [MQTT de Shelly](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Mqtt/); identificación y reinicio con [GetDeviceInfo, /shelly y Reboot](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Shelly/). Se mantiene [HTTP RPC por método](https://shelly-api-docs.shelly.cloud/gen2/General/RPCChannels/), sin mezclar sus resultados con envoltorios de otros canales.
