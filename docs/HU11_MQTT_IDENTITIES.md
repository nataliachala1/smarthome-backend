# HU11 — Identidad MQTT y ACL: primer incremento

Fecha: 2026-10-15. Rama `11-dev`, desde `10-dev` / `63f4bf56a203ddb514fb53e935dc5860944f2e0a`. La rama coordinada de base de datos parte de `10-dev` / `9b9742b6d8f344440145d5b233e33161f9ac1d56`. Esta dependencia se debe al contrato de namespace y TLS implementado en HU10, no al orden numérico. Diff y resultados de pruebas presentados; commit/push autorizados por el usuario el 2026-10-15.

## Resultado y alcance

Se implementaron y probaron políticas ACL por identidad, un transporte administrativo Mosquitto Dynamic Security y operaciones internas de emisión, rotación y revocación de credenciales. Las pruebas usan un broker real TLS desechable, dos dispositivos simulados y una identidad de servicio separada de la administrativa.

El adaptador **no está registrado como proveedor automático de Nest ni expuesto por HTTP**. No se modifica el broker configurado por la aplicación al arrancar. El bloqueo `MQTT_DEVICE_BOOTSTRAP_REQUIRED` de HU10 se conserva. Antes de conectarlo con pairing o baja se necesita persistir la identidad reservada, autorizar al actor y resolver los fallos entre BD y broker. No se declara HU11 completa ni un alta cloud funcional.

## Implementación

| Archivo | Responsabilidad |
| --- | --- |
| `src/modules/devices/infrastructure/messaging/identity/device-mqtt-policy.ts` | Deriva usuario, client ID, rol y ACL del namespace y del ID de fabricante validado. |
| `src/modules/devices/infrastructure/messaging/identity/mosquitto-admin.transport.ts` | Envía comandos con correlación, plazo y errores estables; espera respuesta administrativa, no solo PUBACK. |
| `src/modules/devices/infrastructure/messaging/identity/mosquitto-device-identity.admin.ts` | Emite una contraseña aleatoria, rota y deshabilita identidades por UUID. |
| `mqtt-topic-contract.ts` y `mqtt-device-control.publisher.ts` | Alinean `src` de Shelly con la ruta de respuesta exclusiva del dispositivo. |
| `scripts/test-mqtt-identity.cjs` | Crea broker/certificados/credenciales temporales, ejecuta la suite y elimina solo sus artefactos. |
| Repositorio BD: `tests/mqtt/mosquitto.conf` | Fixture TLS sin anónimo, con Dynamic Security y estado en tmpfs. No es configuración de producción. |

La identidad técnica recibe un UUID v4 generado por el servidor futuro; `device-<uuid>` es su usuario y nombre de rol. El client ID queda vinculado al `manufacturerDeviceId`. La contraseña contiene 32 bytes aleatorios y solo se devuelve tras la respuesta positiva del broker. El adaptador no la escribe a disco, BD ni logs. Mosquitto guarda su verificador; la suite comprueba ausencia de contraseñas emitidas en su archivo de estado.

El identificador del fabricante no demuestra posesión. Este adaptador interno no reserva unicidad por dispositivo/hogar en PostgreSQL, no autoriza propietarios y no impide por sí solo que un administrador técnico emita dos identidades para el mismo fabricante. Esas condiciones deben resolverse antes de ofrecer un flujo de alta.

## Política de tópicos

Con `N = namespace`, `I = manufacturerDeviceId` y `S = MQTT_SHELLY_RPC_SOURCE` (por defecto `N/backend`):

| Identidad | Publica | Recibe y se suscribe |
| --- | --- | --- |
| Shelly I | `N/devices/I/status/switch:0`, `N/devices/I/events/rpc`, `N/devices/I/online`, `S/devices/I/rpc` | Solo `N/devices/I/rpc` |
| Equipo con contrato interno I | `N/devices/I/status` | Solo `N/devices/I/control` |
| Servicio backend | `N/devices/+/control`, `N/devices/+/rpc` | Filtros de estado de HU10 y `S/devices/+/rpc` |
| Administrador de prueba | Canal `$CONTROL/dynamic-security/v1` | Su canal de respuesta administrativa |

Las ACL de equipo son literales y no contienen comodines. El componente de Shelly sigue `MQTT_SHELLY_SWITCH_ID`; el valor de la prueba es 0. No se permite a un equipo publicar órdenes ni leer telemetría de otro. El backend de negocio no recibe permisos de administración del broker. Las ACL técnicas no cambian los roles OWNER/MEMBER/GUEST de la aplicación.

El adaptador comprueba que los defaults de publicación, recepción y suscripción sean denegatorios antes de crear o rotar una identidad. Si no puede verificarlo, no realiza esas operaciones. Configurar `allow_anonymous false` y conservar esos defaults es responsabilidad operativa del broker; la fixture lo hace explícitamente.

**Cambio de compatibilidad:** con namespace, el publisher usa `src = S/devices/I`; la respuesta de Shelly se espera en `S/devices/I/rpc`. No envía la respuesta al tópico compartido `S/rpc`. La política de equipo concede publicación solo a su ruta. Las instalaciones que ya hayan configurado ACL de respuesta deben coordinarlas con este cambio. Sin namespace se conserva el contrato local anterior. Todavía no hay correlación de la respuesta Shelly con el estado físico del comando.

## Transporte y fallos

El transporte exige una conexión dedicada `mqtts`, `rejectUnauthorized: true`, `clean: true` y `reconnectPeriod: 0`. No lee variables ni abre conexiones por sí mismo. Después de un error/desconexión se descarta el transporte; el llamador debe cerrar su cliente y crear uno nuevo. No se comparten las credenciales administrativas con el servicio de telemetría ni con equipos.

Cada comando tiene correlación aleatoria, límite de espera de 5 s por defecto (máximo 30 s) y espera el SUBACK antes de publicar con QoS 1, sin retain. Se aceptan hasta 32 comandos pendientes. Respuestas retenidas, demasiado grandes, malformadas o ajenas no confirman operaciones. Los mensajes crudos del broker no se adjuntan al error.

| Código | Significado |
| --- | --- |
| `MQTT_ADMIN_UNAVAILABLE` | No se pudo enviar: conexión, suscripción, transporte cerrado o límite de pendientes. |
| `MQTT_ADMIN_REJECTED` | El broker respondió con error para el comando correlacionado. |
| `MQTT_ADMIN_OUTCOME_UNKNOWN` | El comando pudo haber sido aplicado, pero faltó confirmación válida por timeout/error. Requiere reconciliación. |
| `MQTT_ADMIN_INVALID_RESPONSE` | La respuesta correlacionada no coincide con el comando; no se confirma el resultado. |
| `MQTT_ADMIN_UNSAFE_DEFAULT_ACL` | No se verificaron defaults denegatorios; se impide crear/rotar. |

`provision` verifica defaults, crea un rol y después un cliente con credencial y client ID. No reescribe un rol/cliente existente para disimular un duplicado. Si falla después de crear el rol, este puede quedar huérfano; si se pierde la respuesta de creación del cliente, su estado es incierto. No hay transacción distribuida ni rollback automático.

`rotate` deshabilita primero, cambia la contraseña y habilita al confirmar las etapas anteriores. Si falla el cambio de contraseña no intenta habilitar. Una respuesta perdida al habilitar sigue siendo incierta. La entrega de la nueva credencial y recuperación del equipo aún no están integradas. Esta operación interna puede reactivar una identidad: su uso requiere autorización/revalidación de posesión en el orquestador futuro.

`revoke` usa `disableClient`, que en las pruebas desconecta la sesión abierta y bloquea reconexión. Repetirla sobre una identidad existente deshabilitada es válido; una identidad inexistente produce error, sin afirmar que hubo revocación. No borra la identidad del broker ni actúa sobre tablas o históricos. Esto todavía **no conecta la baja HTTP con la revocación MQTT**.

## Evidencia ejecutada

| Verificación | Resultado |
| --- | --- |
| Unitarias (`npm test -- --runInBand`) | 195 aprobadas en 7 suites: 155 heredadas de HU10 + 40 nuevas. |
| Integración sintética HU10 | 31 aprobadas, incluido el nuevo `src` por dispositivo. |
| Broker real desechable | 28 aprobadas con Mosquitto 2.0.22, TLS real y equipos simulados. |
| Build, `tsc --noEmit`, ESLint de 8 archivos TypeScript, `node --check` del script | Aprobados. |

La suite del broker confirma certificado confiable, rechazo de CA desconocida/nombre incorrecto, rechazo anónimo/contraseña incorrecta, vínculo del client ID, entrega de control/telemetría autorizados, PUBACK/SUBACK negativos en acceso cruzado, aislamiento del canal administrativo y de respuestas RPC, rechazo de duplicados, rotación y revocación de conexión abierta. Comprueba conexión/control/revocación tanto con MQTT 5 como con MQTT 3.1.1; los rechazos detallados PUBACK se observan en MQTT 5. No se probó firmware Shelly.

Imagen de prueba: `eclipse-mosquitto:2.0.22`, ID local `sha256:b0c5431e316355753ed6d7e17acc796eb4ee0deeb487b69b81dba5ed48e6caf4`; manifiesto oficial Linux/amd64 verificado `sha256:cba7cd79d4e48b2e668b599c100bc5bb612a2c85aada76ab5a27987ecc81e3d7`. El fallo DNS de Docker se resolvió descargando los artefactos oficiales desde el host y verificando sus hashes, sin cambiar DNS global ni configuración Docker. La versión fijada identifica la evidencia de esta prueba; no es una selección de versión/proveedor para producción.

La fixture escucha TLS en un puerto aleatorio publicado únicamente en `127.0.0.1`, sin volúmenes existentes. Usa CA y claves de un día, credenciales aleatorias y estado tmpfs. Los contenedores y certificados de cada ejecución fueron eliminados; la imagen queda en la caché Docker. No se usó el broker local existente, Shelly, PostgreSQL, `.env` real ni servicios cloud.

Para repetir desde la raíz del backend con Docker, Node, dependencias y OpenSSL disponibles:

```powershell
docker pull eclipse-mosquitto:2.0.22
node scripts/test-mqtt-identity.cjs C:/ruta/al/smarthome-database
```

En este workspace, la copia coordinada es `../hu11-database` respecto a `.tmp/hu11-backend`. El script no descarga imágenes automáticamente y no acepta una URL de broker externo. En Windows busca OpenSSL de Git; se puede indicar otro ejecutable mediante `OPENSSL_EXECUTABLE`. La suite individual queda omitida sin las variables temporales que prepara el script.

## Pendientes de integración

- Selección del broker/proveedor cloud y operación de su identidad administrativa. El adaptador Mosquitto aprovecha la tecnología ya referenciada en Compose, sin adoptar un servicio cloud.
- Changesets incrementales para metadatos de identidad, reserva única por dispositivo, estado/versionado y auditoría sin contraseña en claro. Aún no hay DDL ni repositorio PostgreSQL en este incremento.
- Orquestador que serialice emisión/rotación/revocación y reconcilie incertidumbre con BD y broker. Definir reintentos y recuperación sin ampliar permisos ni borrar historia.
- Contrato de posesión y pairing con móvil (HU12), entrega segura del secreto y configuración TLS/client ID/prefijo en el Shelly real (HU13). No enviar contraseña Wi-Fi al backend central.
- Vincular la baja a una revocación verificable, con resultados explícitos en fallos. Mantener datos históricos y no suponer apagado físico.
- Integrar los cambios pendientes de HU13 y los publicados de HU16 antes de una entrega conjunta. HU11 parte de HU10 y no contiene automáticamente esas correcciones.

## Referencias

- [Mosquitto Dynamic Security: identidades y ACL](https://mosquitto.org/documentation/dynamic-security/).
- [API administrativa de la versión 2.0.22](https://github.com/eclipse-mosquitto/mosquitto/blob/v2.0.22/plugins/dynamic-security/README.md).
- [Implementación de autenticación de esa versión](https://github.com/eclipse-mosquitto/mosquitto/blob/v2.0.22/plugins/dynamic-security/auth.c).

Estas referencias se contrastaron con las pruebas descritas; no acreditan una instalación productiva.
