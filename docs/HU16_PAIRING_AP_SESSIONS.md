# HU16 — Sesiones backend para alta Shelly por AP

Fecha: 16/10/2026. Implementación de backend en `16-dev`, coordinada con Liquibase `019_device_pairing_sessions` en la rama `16-dev` de base de datos. El backend coordina el flujo y protege el registro; Android realiza las operaciones RPC locales. Esta entrega no modifica el proyecto móvil ni certifica la POC física.

## Contratos

Todos requieren JWT y autorización backend de `OWNER` activo del hogar en cada llamada. La sesión queda vinculada al usuario creador. El flujo usa únicamente AP; BLE responde `PAIRING_METHOD_NOT_AVAILABLE` hasta una POC nativa aprobada.

| Método y ruta | Solicitud | Resultado |
| --- | --- | --- |
| `GET /api/v1/homes/:homeId/shelly/setup-capabilities` | Sin body | Devuelve `S4SW-001P16EU`, generación 4, AP como método preferido, RPC local `http://192.168.33.1`, BLE no disponible, política de firmware sin configurar y estado de MQTT individual bloqueado hasta validar proveedor y evidencia. No garantiza que el AP esté activo en un equipo concreto. |
| `POST /api/v1/homes/:homeId/shelly/setup-sessions` | `{ requestId, sessionToken, method: "AP" }` | Crea o devuelve idempotentemente la sesión `PENDING`. `requestId` es UUID; el token debe ser aleatorio de al menos 32 bytes, URL-safe y se persiste solo su SHA-256. |
| `POST /api/v1/homes/:homeId/shelly/setup-sessions/:sessionId/identify` | `{ manufacturerDeviceId, modelCode, generation, firmwareVersion? }` y `X-Pairing-Token` | Valida `S4SW-001P16EU` y generación `4`, reserva el identificador globalmente contra altas y sesiones activas, y responde `DEVICE_IDENTIFIED`. La identidad se marca `MOBILE_REPORTED_UNVERIFIED`: no es prueba criptográfica de posesión. |
| `GET /api/v1/homes/:homeId/shelly/setup-sessions/:sessionId` | `X-Pairing-Token` | Devuelve estado, expiración, identidad reportada y resultado, sin contraseñas ni hashes. |
| `POST /api/v1/homes/:homeId/shelly/setup-sessions/:sessionId/complete` | `{ name }` y `X-Pairing-Token` | Solicita el cierre. Desde `DEVICE_IDENTIFIED` pasa a `WAITING_FOR_MQTT` y devuelve estado no completado. Solo desde `CONNECTED`, que requiere una futura verificación confiable del broker, crea el dispositivo y marca `COMPLETED` dentro de la misma transacción. Repetir luego de completado devuelve el mismo ID. |
| `DELETE /api/v1/homes/:homeId/shelly/setup-sessions/:sessionId` | `X-Pairing-Token` | Cancela sesión activa; repetición tras cancelación/vencimiento es idempotente. No cancela una vinculación completada. |

Los endpoints existentes `discover`, `identify` y `provision` siguen siendo para dispositivos accesibles desde la red del backend; no se reutilizan para AP. El registro genérico `POST /homes/:homeId/devices` tampoco completa pairing.

## Estados y reintentos

`PENDING → DEVICE_IDENTIFIED → WAITING_FOR_MQTT → CONNECTED → COMPLETED`; cualquier estado activo puede terminar en `EXPIRED`, `CANCELLED` o `FAILED` según reglas SQL. La expiración es de 10 minutos en esta primera versión. No se guarda como estado de backend el resultado local de Wi-Fi que Android no puede acreditar al servidor.

Las caídas locales, Wi-Fi y MQTT deben permitir reintentar dentro de la sesión vigente. Los errores de red/AP, autenticación Shelly o credenciales Wi-Fi son del flujo local de Android y no se fingen como errores medidos por el backend. Errores API estables incluyen `HOME_OWNER_REQUIRED`, `PAIRING_TOKEN_INVALID`, `PAIRING_SESSION_EXPIRED`, `PAIRING_IDEMPOTENCY_KEY_REUSED`, `PAIRING_DEVICE_ALREADY_REGISTERED`, `PAIRING_MODEL_UNSUPPORTED`, `PAIRING_METHOD_NOT_AVAILABLE`, `PAIRING_SESSION_NOT_READY` y `PAIRING_MQTT_NOT_CONFIRMED` en la respuesta de espera. No hay una política de firmware compatible configurada aún; informar una versión no basta para declararla aprobada.

El backend no registra secretos en DTOs o respuestas. El teléfono no debe enviar contraseña Wi-Fi a la API. El token de pairing es secreto de autorización de sesión, no una contraseña MQTT; los headers `X-Pairing-Token` deben redactarse de los logs. BLE aún no está habilitado.

## Límite de cierre

`MQTT.SetConfig` de Shelly admite servidor, usuario y contraseña; `MQTT.GetStatus` informa `connected`. La lectura local de ese estado por Android no demuestra al backend qué cliente se autenticó. La finalización exige evidencia observada por el backend o un componente de confianza del broker, vinculada a una credencial individual y a la identidad reservada. El código de esta entrega no recibe aún ese evento ni emite credenciales individuales para EMQX Serverless; `setup-capabilities` lo declara bloqueado. Por tanto las sesiones y el endpoint de cierre ya coordinan, pero el alta no puede llegar a `CONNECTED`/`COMPLETED` hasta que se valide e integre ese proveedor.

La app debe iniciar sesión antes de unirse al AP, leer identidad/modelo localmente, informar identidad, enviar Wi-Fi directamente al dispositivo, tolerar pérdida temporal de Internet, reconectarse a Internet, pedir cierre y consultar estado. Las contraseñas Wi-Fi/MQTT no deben guardarse en la base SmartHome, SecureStore, analytics o logs. AP, firmware beta instalado, autenticación local y comportamiento de Android requieren prueba en el Shelly real. Este código no afirma que la integración AP móvil ya exista.
