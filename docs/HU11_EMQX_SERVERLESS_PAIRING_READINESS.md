# HU11/HU12 — EMQX Serverless, pairing y activación coordinada

Fecha: 2026-10-15. Backend `11-dev`, base `7730ff12fe1c86347f8c87adf02ea2d16e801825`; BD `11-dev`, base `a9589cac2f845f5135a64a49fd683b24b975555c`. Incremento revisado y autorizado para commit/push el 2026-10-15. **HU11/HU12 continúan abiertos.**

## Resultado

El usuario confirmó EMQX Cloud Serverless como broker de producción, TLS en puerto 8883 y Shelly 1PM Gen4. El administrador de identidades desarrollado anteriormente utiliza Mosquitto Dynamic Security. Sus pruebas demuestran comportamiento de esa implementación, no compatibilidad administrativa con EMQX.

El backend ahora exige `MQTT_IDENTITY_PROVIDER` cuando `MQTT_REVOCATION_ENABLED=true`. La comprobación ocurre durante la validación de la aplicación y la construcción del trabajador, antes de crear su pool, temporizador o cliente administrativo.

| Configuración del trabajador | Resultado |
| --- | --- |
| Desactivado o bandera omitida | Comportamiento previo; no abre recursos del trabajador. |
| Activado, proveedor ausente/vacío | `MQTT_REVOCATION_CONFIG_REQUIRED:MQTT_IDENTITY_PROVIDER`. |
| Activado, `emqx-serverless` | `MQTT_REVOCATION_PROVIDER_UNSUPPORTED`. |
| Activado, `mosquitto-dynamic-security` | Continúa con las validaciones de credenciales separadas, TLS, destino BD y auditoría. |
| Activado, otro valor | Error de configuración sin devolver el valor recibido. |

El proveedor es una declaración del operador, no una detección del servidor remoto. La conexión MQTT de servicio mantiene su configuración HU10. `.env.example` declara el proveedor confirmado y conserva el trabajador desactivado. Las fixtures seleccionan Mosquitto explícitamente. **Una instalación que ya habilitaba el trabajador debe añadir el proveedor correcto antes de actualizar:** es un nuevo requisito de arranque.

## Capacidades del proveedor

Documentación oficial consultada el 2026-10-15. No se accedió a una cuenta EMQX del proyecto.

| Necesidad | Evidencia y consecuencia |
| --- | --- |
| MQTT sobre TLS | Serverless documenta 8883. La conexión del Shelly real y su CA están por probar. [Guía de puertos](https://docs.emqx.com/en/cloud/latest/deployments/port_guide_serverless.html). |
| Operaciones de la API Serverless | El contrato público lista gestión/consulta de clientes conectados, desconexión, suscripciones y publicación; no CRUD de credenciales ni ACL. Las claves de API Serverless son de acceso completo a las operaciones que expone ese contrato, no a endpoints Dedicated. [API Serverless](https://docs.emqx.com/en/cloud/latest/api/serverless.html), [API por tipo de despliegue](https://docs.emqx.com/en/cloud/latest/api/api_deployment.html). |
| Autenticación | Serverless soporta autenticación por contraseña y X.509; HTTP extended authentication/JWT no aparecen soportadas en la matriz por plan. Esto enumera mecanismos de autenticación, no un endpoint para crear/revocar una identidad por dispositivo. [Autenticación EMQX Cloud](https://docs.emqx.com/en/cloud/latest/deployments/auth_overview.html), [crear Serverless](https://docs.emqx.com/en/cloud/latest/create/serverless.html). |
| Autorizar MQTT contra NestJS/PostgreSQL | Serverless no admite extended authorization HTTP/PostgreSQL. Por tanto, el backend no puede usar esa ruta para aplicar al vuelo las ACL persistidas en PostgreSQL. [Soporte por despliegue](https://docs.emqx.com/en/cloud/latest/deployments/authz_overview.html), [extended authorization](https://docs.emqx.com/en/cloud/latest/deployments/custom_authz.html). |
| ACL integrada | Se pueden gestionar/importar reglas desde consola; Serverless requiere una regla deny-all para obtener comportamiento whitelist. La documentación pública revisada describe operaciones de consola, no una API Serverless para automatizar el CRUD. La configuración manual solo sirve para un piloto operado, no para el alta/revocación automática multiusuario del producto. [Autorización predeterminada](https://docs.emqx.com/en/cloud/latest/deployments/default_authz.html). |

**Conclusión (documentación oficial consultada el 2026-10-15):** el contrato público Serverless permite operar clientes conectados y mensajes, pero no expone en su API documentada la gestión de credenciales o ACL; tampoco ofrece extended authorization contra el backend. La consola permite configurar autenticación/ACL de forma manual, que no resuelve altas y bajas automatizadas por dispositivo. No se extrapola la API Dedicated ni se sustituye el proveedor elegido. La conclusión queda limitada a las capacidades públicas descritas: EMQX aún podría confirmar por escrito otro mecanismo soportado para esta cuenta/plan.

### Consulta preparada para EMQX, no enviada

> Usamos EMQX Cloud Serverless. Necesitamos crear una credencial individual inicialmente sin acceso, asociar ACL, verificar política efectiva, habilitarla y revocarla impidiendo reconexiones. ¿Qué API pública soportada ofrece exactamente este plan? Solicitamos documentación/versionado, autenticación administrativa, límites, semántica ante duplicados/timeouts, propagación de cambios y vínculo username/client ID. ¿Qué mecanismo evita que una habilitación retrasada reactive una identidad retirada? La referencia Serverless consultada enumera clientes, suscripciones y publicación, sin administración de credenciales/ACL.

No se envió la consulta ni se cambió el plan. Una credencial manual de laboratorio puede servir para probar conectividad, pero no satisface el alta automática multiusuario.

## Referencia móvil y prueba física

Se inspeccionó [`from_movil/dev`, commit `0dc85b0d0215ded9004c69881a095bb99461ebf5`](https://github.com/Kevin-Stiven-Lopez-Amaya404/from_movil/tree/0dc85b0d0215ded9004c69881a095bb99461ebf5), indicado por el usuario, en una copia aislada y sin modificarlo:

- Expo `~57.0.21`, React Native `0.86.3`, `expo-dev-client` `~57.0.19`; no declara biblioteca BLE nativa.
- `lib/pairing/ble-adapter.ts` devuelve indisponibilidad y rechaza descubrimiento/conexión.
- `lib/services/pairing-service.ts` devuelve `PAIRING_UNSUPPORTED`; no implementa una ruta acordada.
- Los tipos/transiciones de `lib/pairing` son propuestas móviles, no un contrato compartido validado.

Se preparó el [protocolo de POC BLE](HU12_SHELLY_ANDROID_BLE_POC.md), incluyendo el requisito Shelly de bonding fuera de la ventana inicial y el riesgo de compatibilidad entre Expo 57/RN 0.86 y la biblioteca BLE upstream. El propietario reportó el Shelly `S4SW-001P16EU`, ID `d885acf06990` y firmware `20260819-101735/2.0.1-beta1-g8a88c73`; la versión/build aún debe confirmarse en la interfaz web local. La IP local no se persiste en el repositorio. La disponibilidad de un Android físico sigue sin confirmar y `adb` no se encontró en PATH ni en la ubicación estándar del SDK.

Desde esa inspección, el clon aislado de `from_movil/dev` recibió un escáner Android de anuncios Shelly, sin conexión ni cambios de configuración. TypeScript, ESLint, cinco pruebas de configuración y Expo prebuild pasaron; la validación en APK/hardware sigue pendiente porque este entorno no tiene Android SDK ni `adb`. `pairingService.createSession` y el contrato del servidor siguen sin cambios.

## Coordinación con PostgreSQL

Se mantienen 64 changesets, el modelo Prisma y las funciones/roles HU11. Este incremento no añade DDL. El registro actual no reserva una sesión de pairing: ejecutar `prepare()` y luego `fn_register_mqtt_identity()` no garantiza atomicidad.

Después de validar la POC y la administración del broker, el cierre exige:

1. Contrato móvil/backend con endpoints, DTO, errores y transiciones decididas por el servidor. Solo OWNER. Wi-Fi se configura directamente desde Android al Shelly; su contraseña nunca llega al backend ni se guarda en SecureStore.
2. Nuevos changesets para reserva/sesión temporal, consumo único, idempotencia, unicidad global del fabricante y autorización/RLS. Recuperación en el mismo hogar con evidencia; traslado entre hogares bloqueado en el MVP.
3. Intención y compensación durables antes de modificar el broker; coordinación con cancelación, expiración y baja. Un timeout administrativo conserva incertidumbre, no éxito.
4. Verificación de identidad, evidencia de vinculación y conexión antes de completar. Quien recibe una contraseña MQTT puede emular mensajes; eso no acredita por sí solo posesión del Shelly.
5. Pruebas de caída/reintento y de habilitación retrasada tras revocación. Conservar históricos y no apagar físicamente el equipo al desvincularlo.

## Evidencia

317 pruebas unitarias en 13 suites aprobadas, incluidas 11 nuevas de proveedor/arranque. El ensayo anterior de retiro terminal de Mosquitto se conservó aparte con su diff recuperable: no forma parte del incremento activo ni está conectado al runtime.

Comprobación final de TypeScript (`tsc --noEmit`), compilación Nest y ESLint de los cuatro archivos TypeScript afectados: aprobada. La ejecución final del incremento reducido aprobó **117 pruebas reales: 76 PostgreSQL/runtime y 41 Mosquitto TLS**. Migración desde cero, rollback vacío/reaplicación y actualización **62 → 63 → 64** aprobados; datos/checksums conservados y rollback con historial poblado rechazado. Comando desde backend: `node scripts/test-mqtt-revocation.cjs ../hu11-database`. Los contenedores propios se retiraron al terminar.

La ejecución anterior con el ensayo Mosquitto presente aprobó 122 pruebas reales; esas cinco pruebas adicionales corresponden al ensayo archivado, no al incremento que se propone publicar. Ninguna de estas ejecuciones certifica EMQX ni pairing físico.

No se modificaron `.env`, bases del proyecto, credenciales productivas ni Shelly físico. El informe de BD se actualiza en paralelo; la publicación de este incremento requiere revisión del diff y las pruebas.
