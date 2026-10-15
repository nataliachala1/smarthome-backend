# HU12 — POC Android/BLE con Shelly 1PM Gen4

Fecha: 2026-10-15. **Preparada, no ejecutada con hardware.** No es un contrato API aprobado ni pairing implementado. BLE es la primera vía de prueba; AP/RPC permanece como alternativa pendiente.

## Punto de partida

Referencia: [`from_movil/dev`, `0dc85b0d0215ded9004c69881a095bb99461ebf5`](https://github.com/Kevin-Stiven-Lopez-Amaya404/from_movil/tree/0dc85b0d0215ded9004c69881a095bb99461ebf5). Tiene `expo-dev-client`, pero su adaptador BLE devuelve indisponibilidad. La POC local debe poder ejecutarse sin `pairingService.createSession()`, que hoy rechaza siempre antes de llegar al descubrimiento.

La compilación Android debe incorporar una biblioteca BLE compatible con las versiones del proyecto. Incluir `expo-dev-client` no demuestra que exista ese APK ni soporte BLE instalado. [Compilaciones de desarrollo Expo](https://docs.expo.dev/develop/development-builds/introduction/).

La ficha del 1PM Gen4 enumera BLE, Wi-Fi y MQTT; falta validar su combinación en el firmware real. [API del dispositivo](https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen4/Shelly1PMG4/).

## Preparación y orden de operaciones

Registrar modelo exacto, firmware/build, estado de provisión, Android/API, versión del APK y commit. Usar equipo de laboratorio sin carga peligrosa. Reset, actualización, Wi-Fi/MQTT y reinicio requieren acordar la operación concreta con su propietario.

Shelly documenta protección de provisión desde 1.7.5: AP abierto/BLE RPC pueden cerrarse al adquirir IP o agotar la ventana inicial. Debe medirse el orden de escritura MQTT/Wi-Fi y la recuperación del canal; escribir Wi-Fi primero podría interrumpir la configuración posterior. [Provisión segura](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Sys/#secure-provisioning).

Desde 2.0.0, la documentación distingue ventana inicial de conexiones BLE con bonding, describe “Just Works” y métodos de gestión de emparejamientos. Validar su disponibilidad en el firmware instalado. El bonding local no constituye automáticamente evidencia verificable por NestJS. [BLE](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/BLE/).

No adoptar UUID GATT/framing de otros productos BLU por analogía. Contrastar el perfil documentado con servicios/características del 1PM Gen4 real; nombre anunciado y RSSI solo seleccionan candidatos, no autentican identidad.

## Pruebas y aceptación

| Caso | Evidencia exigida | Estado |
| --- | --- | --- |
| POC-01 — Compilación/permisos | APK con BLE nativo instalado; Bluetooth apagado y permisos denegados gestionados sin éxito ficticio | Pendiente |
| POC-02 — Descubrimiento | Dispositivos reales, timeout, cancelación y limpieza de listeners/conexiones | Pendiente |
| POC-03 — GATT/RPC de lectura | Perfil real, `Shelly.GetDeviceInfo`, `BLE.GetConfig`, estado de provisión disponible; correlación, tamaños y timeouts acotados | Pendiente |
| POC-04 — Protección local | Requisitos de bonding/autenticación medidos; cliente no autorizado rechazado cuando corresponde | Pendiente |
| POC-05 — Configuración | Wi-Fi/MQTT aprobados enviados directamente al Shelly; orden medido, desconexiones y `restart_required` tratados | Pendiente |
| POC-06 — Cloud | TLS verificado, identidad individual/namespace propio, observación desde broker/backend; fallo con CA/hostname incorrectos | Pendiente |
| POC-07 — Recuperación | App cerrada, BLE perdido, Wi-Fi sin Internet y reconexión sin duplicados ni confirmación por un ACK local | Pendiente |
| POC-08 — Posesión | Rechazar alta solo con manufacturer ID, evidencia repetida/otra sesión y emulación MQTT con credencial recibida | Pendiente |
| POC-09 — Aislamiento/baja | Dos identidades sin acceso cruzado; baja impide reconexión y habilitación tardía; resultado durable | Pendiente |

Una credencial de laboratorio administrada manualmente puede permitir POC-06, si esa operación se acuerda; no valida el alta automática. POC-09 y el cierre cloud dependen del [contrato administrativo EMQX](HU11_EMQX_SERVERLESS_PAIRING_READINESS.md).

## RPC documentadas que se deben contrastar

Estas son operaciones del dispositivo, no endpoints NestJS ni garantía de que la biblioteca BLE elegida pueda ejecutarlas:

- `Shelly.GetDeviceInfo`: identidad/firmware; información pública insuficiente como prueba de posesión.
- `WiFi.SetConfig`: `config.sta` con `ssid`, `pass`, `enable`. Puede causar reconexión y pérdida de enlaces. [Wi-Fi](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/WiFi/).
- `MQTT.SetConfig`: `server` host:puerto, `client_id`, `user`/`pass`, `topic_prefix` y opciones acordadas. `ssl_ca` debe verificar la CA; `*` desactiva validación y no es admisible. Observar `restart_required` sin reinicio automático. [MQTT](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Mqtt/).
- `MQTT.GetStatus`: `connected` informa conectividad local; contrastar desde cloud, sin equipararlo a posesión. [Estado MQTT](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Mqtt/#status).

Wi-Fi/MQTT deben existir solo transitoriamente en memoria de Android: no guardar sus secretos en SecureStore, AsyncStorage, archivos, logs, telemetría, capturas o comandos del shell. No enviar la contraseña Wi-Fi al backend. Los tokens de sesión de la aplicación conservan su tratamiento existente.

## Cierre de la POC

OWNER, token temporal y conexión MQTT son condiciones necesarias, pero no prueban por separado interacción física. La app que conoce el secreto MQTT puede emular respuestas; un nonce retransmitido por ella tampoco demuestra el origen sin una verificación adicional.

Identificar una evidencia local ligada a la sesión que el backend pueda comprobar con un modelo de confianza explícito. No se ha identificado ni validado un método de atestación criptográfica del 1PM Gen4 para este proyecto. Si hace falta un mecanismo complementario, acordar sus garantías antes de activar altas.

Tras la POC se formalizarán crear/consultar sesión, identificar, confirmar configuración, completar y cancelar. Los estados actuales en móvil son propuestas: el servidor debe decidir las transiciones y no confiar en un `CONNECTED`/`COMPLETED` declarado por Android.

El informe de ejecución registrará resultados por caso, versiones, límites, garantía de posesión y decisión BLE o alternativa AP/RPC. Hasta obtener esas evidencias, pairing y activación coordinada permanecen pendientes.
