# HU12 — POC Android BLE con Shelly 1PM Gen4

Fecha de revisión: 15/10/2026. Rama backend `12-dev`, derivada de `09-dev`. Este avance actualiza evidencia documental; no declara pairing ni activación como implementados.

## Dispositivo y estado comprobado

El propietario reportó modelo `S4SW-001P16EU`, identificador `d885acf06990` y firmware `20260819-101735/2.0.1-beta1-g8a88c73`, observados en la aplicación Shelly. Se debe confirmar versión y build en la página Firmware de la interfaz web local antes de la POC. La IP compartida se omite de este repositorio. No se ha usado el dispositivo desde este entorno ni se han enviado llamadas, credenciales, reinicios o cambios de configuración.

La app móvil tiene en `dev` una POC de escaneo Android y `@sfourdrinier/react-native-ble-plx` 3.9.3. El escáner no conecta a GATT. `pairingService.createSession` todavía devuelve `PAIRING_UNSUPPORTED`; no existe contrato NestJS–Android validado. El commit de escaneo es [`22e93c9`](https://github.com/Kevin-Stiven-Lopez-Amaya404/from_movil/commit/22e93c9).

## Evidencia oficial de Shelly

Shelly publica un perfil de RPC sobre GATT con servicio `5f6d4f53-5f52-5043-5f53-56435f49445f` y características de datos, longitud TX y longitud RX. El cliente envía un objeto JSON-RPC UTF-8: primero escribe el tamaño como entero unsigned de 4 bytes big-endian en TX y luego el contenido en datos. Para la respuesta espera la notificación de longitud por RX y lee el marco desde datos, comprobando el ID JSON-RPC. Las características son:

| Uso | UUID |
| --- | --- |
| Datos | `5f6d4f53-5f52-5043-5f64-6174615f5f5f` |
| Longitud de solicitud (TX) | `5f6d4f53-5f52-5043-5f74-785f63746c5f` |
| Longitud de respuesta (RX) | `5f6d4f53-5f52-5043-5f72-785f63746c5f` |

En firmware 2.0+, BLE RPC requiere bonding fuera de la ventana inicial. `pending` acepta RPC durante una ventana inicial de 15 minutos; `confirmed` da una ventana de gracia; `complete` cierra BLE RPC sin bonding; `locked` deja el anuncio visible pero expone solo GAP. El estado se consulta en `Shelly.GetDeviceInfo`. El bonding utiliza Just Works, cifra el enlace pero no autentica frente a MITM; por ello no basta como prueba criptográfica de posesión para el backend.

Fuentes primarias:

- [Shelly Knowledge Base — BLE RPC over GATT](https://kb.shelly.cloud/knowledge-base/kbsa-communicating-with-shelly-devices-via-bluetoo)
- [Shelly Technical Documentation — BLE](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/BLE/)
- [Shelly Technical Documentation — provisión segura y estado del dispositivo](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Sys/)

Esta documentación permite comenzar una POC aislada de lectura, pero no demuestra que el firmware beta del dispositivo exponga esas características en su estado actual. Como el Shelly ya obtuvo una IP Wi-Fi, su RPC Bluetooth podría estar en estado `complete` y requerir bonding previo. No reiniciar, restablecer, activar BLE pairing ni modificar configuración durante la POC sin autorización operativa explícita del propietario.

## EMQX Serverless y activación

El usuario confirmó EMQX Cloud Serverless para producción. La documentación actual de EMQX lista para Serverless solo la API de clientes, suscripciones y publicación; la autenticación disponible es la base integrada de usuario/contraseña o X.509. La autenticación externa HTTP y autorización externa no están soportadas en Serverless. No se encontró una API de despliegue documentada para crear/eliminar usuarios y reglas ACL de forma dinámica.

Fuentes primarias:

- [Serverless API Overview](https://docs.emqx.com/en/cloud/latest/api/serverless.html)
- [EMQX Cloud authentication support](https://docs.emqx.com/en/cloud/latest/deployments/auth_overview.html)
- [EMQX Cloud authorization support](https://docs.emqx.com/en/cloud/latest/deployments/authz_overview.html)

El administrador Mosquitto Dynamic Security existente no es un adaptador EMQX. No se debe activar la reserva/alta en SQL y luego asumir que EMQX aceptó credenciales. El cierre requiere decidir y probar un mecanismo soportado de alta/baja de identidades y permisos del broker, sin guardar secretos administrativos en la app.

## Puertas de aceptación

| Caso | Evidencia necesaria | Estado |
| --- | --- | --- |
| POC-00 Firmware | Modelo y firmware/build confirmados desde UI web local | Pendiente |
| POC-01 APK | Development build Android, permisos y cancelación verificados | Pendiente |
| POC-02 GATT lectura | Descubrir servicio, bonding según el estado, `Shelly.GetDeviceInfo` y `provision`; tamaños, correlación y timeout | Pendiente |
| POC-03 Identidad | Comparar MAC/modelo reportados por RPC con identidad registrada; probar duplicados y suplantación | Pendiente |
| POC-04 Provisión | Flujo local aprobado, Wi-Fi nunca enviado a backend ni persistido en móvil; orden MQTT/Wi-Fi y reconexión medidos | Pendiente |
| POC-05 Posesión | Evidencia ligada a la sesión que NestJS pueda comprobar; Just Works, nombre, RSSI y manufacturer ID no bastan solos | Pendiente |
| POC-06 Broker | Crear credencial por dispositivo, ACL aislada y baja/revocación probadas en el EMQX real | Bloqueado por contrato de administración Serverless |
| POC-07 Coordinación DB | Consumo único, idempotencia, expiración, cancelación y compensación ante fallos broker/SQL | Pendiente del contrato de broker y POC |

Hasta aprobar estos casos, no crear endpoints que confíen en estados `CONNECTED` o `COMPLETED` enviados por Android, ni registrar una identidad MQTT como activa antes de verificar la aceptación del broker. La implementación y prueba física deben continuar en `12-dev`; no se modifica ninguna base de datos de usuario ni el despliegue.
