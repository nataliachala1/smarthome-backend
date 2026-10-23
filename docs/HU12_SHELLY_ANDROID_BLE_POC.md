# HU12 — POC Android/BLE con Shelly 1PM Gen4

Fecha: 2026-10-15. **Preparada, no ejecutada con hardware.** No es un contrato API aprobado ni pairing implementado. BLE es la primera vía de prueba; AP/RPC permanece como alternativa pendiente.

## Punto de partida

Referencia: [`from_movil/dev`, `0dc85b0d0215ded9004c69881a095bb99461ebf5`](https://github.com/Kevin-Stiven-Lopez-Amaya404/from_movil/tree/0dc85b0d0215ded9004c69881a095bb99461ebf5). Tiene `expo-dev-client`, pero su adaptador BLE devuelve indisponibilidad. La POC local debe poder ejecutarse sin `pairingService.createSession()`, que hoy rechaza siempre antes de llegar al descubrimiento.

### Baseline físico reportado

El propietario reportó desde la aplicación del dispositivo el siguiente baseline, pendiente de confirmación en la interfaz web local:

| Campo | Valor | Tratamiento |
| --- | --- | --- |
| Modelo | `S4SW-001P16EU` (Shelly 1PM Gen4) | Coincide con el dispositivo objetivo de la HU12. |
| Identificador | `d885acf06990` | Se usará solo para correlacionar la POC; no es una prueba de posesión. |
| Firmware reportado | `20260819-101735/2.0.1-beta1-g8a88c73` | Es una versión beta; confirmar versión y build desde la interfaz web antes de probar bonding o provisión. |

La IP local compartida para la comprobación no se persiste en el repositorio. Desde un equipo en la misma red, consultar la interfaz web y registrar en el informe de ejecución la versión/build observados, sin contraseñas, tokens ni capturas que los contengan. Una lectura desde el entorno cloud o desde este agente no sustituye esa confirmación local.

La comprobación de solo lectura intentada desde este entorno no pudo conectar con la interfaz local; el agente no tiene ruta a la LAN del dispositivo. No se enviaron RPC de escritura, credenciales, reinicios ni cambios de configuración.

La compilación Android debe incorporar una biblioteca BLE compatible con las versiones del proyecto. Incluir `expo-dev-client` no demuestra que exista ese APK ni soporte BLE instalado. [Compilaciones de desarrollo Expo](https://docs.expo.dev/develop/development-builds/introduction/).

La ficha del 1PM Gen4 enumera BLE, Wi-Fi y MQTT; falta validar su combinación en el firmware real. [API del dispositivo](https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen4/Shelly1PMG4/).

### Protocolo BLE y compatibilidad móvil

La documentación de Shelly OS indica que BLE RPC requiere bonding fuera de la ventana inicial de provisión. Desde firmware 2.0.0, el bonding usa el método Bluetooth `Just Works`, admite hasta 20 clientes y persiste tras reinicios. La ventana inicial acepta BLE RPC mientras la provisión está `pending` o `confirmed`; en `complete` y `locked` exige bonding. Por ello la POC debe registrar el estado de provisión y el resultado de conexión/bonding sin interpretar ese resultado como autorización OWNER ni como prueba criptográfica de posesión. No invocará `BLE.StartPairing`, `BLE.SetConfig` ni llamadas de aprovisionamiento hasta tener una prueba de lectura acordada y el hardware disponible. [BLE oficial de Shelly](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/BLE/).

### Perfil GATT de RPC: dato pendiente

La documentación oficial confirma que el 1PM Gen4 incluye el componente BLE y que BLE RPC existe con controles de seguridad y bonding. Sin embargo, la página [RPC Channels](https://shelly-api-docs.shelly.cloud/gen2/General/RPCChannels/) describe HTTP, WebSocket, MQTT y UDP; no especifica el servicio/características GATT ni el framing de RPC sobre BLE. La [página BLE](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/BLE/) documenta el comportamiento RPC/bonding y métodos del componente, pero tampoco publica ese perfil de transporte para un cliente Android. La [ficha del 1PM Gen4](https://shelly-api-docs.shelly.cloud/gen2/Devices/Gen4/Shelly1PMG4/) enumera BLE sin detallar el perfil GATT.

La página de [características comunes de Shelly BLU](https://shelly-api-docs.shelly.cloud/docs-ble/common/) limita expresamente su alcance a dispositivos BLU alimentados por batería. Sus UUID, características y formato de anuncios no se deben reutilizar para el Shelly 1PM Gen4. Hasta obtener una especificación oficial aplicable o validar de forma controlada el perfil del equipo real, la app se limita al escaneo de anuncios: no conecta, no hace bonding y no envía RPC. El caso POC-03 permanece bloqueado por este dato más la prueba con firmware confirmado.

La app usa Expo SDK 57 y React Native 0.86.3. El upstream `react-native-ble-plx` documenta pruebas hasta Expo 51/RN 0.74.1, por lo que no se selecciona para esta app sin adaptación. Existe `@sfourdrinier/react-native-ble-plx` que declara RN 0.86/Expo 57 y CNG, pero es un fork comunitario que requiere evaluación de mantenimiento, licencia, build limpio, Expo Doctor y prueba BLE en Android antes de adoptarlo. La presencia del paquete o un build exitoso no valida la interacción con Shelly. [Compatibilidad upstream](https://github.com/dotintent/react-native-ble-plx), [fork para RN 0.86/Expo 57](https://www.npmjs.com/package/@sfourdrinier/react-native-ble-plx).

## Preparación y orden de operaciones

Registrar modelo exacto, firmware/build, estado de provisión, Android/API, versión del APK y commit. Usar equipo de laboratorio sin carga peligrosa. Reset, actualización, Wi-Fi/MQTT y reinicio requieren acordar la operación concreta con su propietario.

Shelly documenta protección de provisión desde 1.7.5: AP abierto/BLE RPC pueden cerrarse al adquirir IP o agotar la ventana inicial. Debe medirse el orden de escritura MQTT/Wi-Fi y la recuperación del canal; escribir Wi-Fi primero podría interrumpir la configuración posterior. [Provisión segura](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Sys/#secure-provisioning).

Desde 2.0.0, la documentación distingue ventana inicial de conexiones BLE con bonding, describe “Just Works” y métodos de gestión de emparejamientos. Validar su disponibilidad en el firmware instalado. El bonding local no constituye automáticamente evidencia verificable por NestJS. [BLE](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/BLE/).

No adoptar UUID GATT/framing de otros productos BLU por analogía. El perfil de transporte BLE RPC del 1PM Gen4 sigue sin estar especificado en las fuentes públicas consultadas (2026-10-15); contrastarlo con una especificación oficial aplicable o medirlo en el equipo real antes de implementar conexión. Nombre anunciado y RSSI solo seleccionan candidatos, no autentican identidad.

## Pruebas y aceptación

### Incremento de descubrimiento Android

En el clon local de `from_movil/dev` se integró un escáner Android de anuncios cuyo nombre empieza por Shelly, con permisos en tiempo de ejecución, timeout, cancelación y resultados ordenados por RSSI. El escáner no conecta, no inicia bonding y no escribe configuración; el nombre y RSSI se muestran como candidatos sin autenticar. Se fijó `@sfourdrinier/react-native-ble-plx` `3.9.3` (MIT) y su config plugin porque el upstream no declara compatibilidad con Expo 57/RN 0.86.

Verificación local: TypeScript, ESLint y las 5 pruebas `test:mobile-config` pasaron; `expo prebuild --platform android --no-install` terminó con éxito usando `com.smarthome.poc` solo en el entorno del proceso. La configuración generada incluye permisos BLE y ubicación. No hay Android SDK ni `adb` en este entorno, así que no se compiló/instaló un APK ni se ejecutó el escaneo contra el Shelly. La dependencia está en un fork comunitario con búsqueda pública de mantenedores y queda sujeta a revisión antes de producción.

| Caso | Evidencia exigida | Estado |
| --- | --- | --- |
| POC-00 — Confirmación de firmware | Modelo/ID coinciden; versión y build beta confirmados en la interfaz web local | Reportado; confirmación pendiente |
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
