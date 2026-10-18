# HU10 — MQTT con TLS y namespace: primer incremento

Fecha: 2026-10-15. Rama `10-dev`, creada desde `09-dev` (`6b033fe34775af269ba8138688a26f7f5f82e694`). Incremento revisado con diff y pruebas; commit y push autorizados por la responsable. Este avance implementa la parte de cliente backend de BD-07 y documenta requisitos de BD-06. No completa HU10 ni certifica conectividad cloud.

## Cambios verificables

- `parseMqttConfig` se ejecuta en la validación de arranque. En producción exige broker `mqtts://`, usuario/contraseña de servicio y namespace explícito. Fuera de producción permite MQTT deshabilitado o TCP local para compatibilidad.
- Solo admite `mqtt://` y `mqtts://` con host y puerto válidos; rechaza credenciales en la URL, rutas, parámetros, fragmentos y formas ambiguas entre parsers. Los errores de configuración no incluyen los valores suministrados.
- Publisher y subscriber comparten `MqttRuntimeService`: verificación TLS obligatoria, mínimo TLS 1.2 y verificación de nombre de servidor de Node/MQTT.js. No hay opción para aceptar certificados inválidos. `NODE_TLS_REJECT_UNAUTHORIZED=0` se rechaza al usar TLS.
- `MQTT_TLS_CA_FILE` permite un bundle PEM opcional. Se lee y valida al construir el servicio; no se imprime su ruta/contenido si falla. Sin archivo se usa la confianza predeterminada de Node. Un CA suministrado sustituye la lista predeterminada para esta conexión. No se implementó mTLS.
- Los dos clientes tienen IDs distintos; si se omiten se generan IDs con UUID por instancia. Las réplicas deben omitir los IDs fijos o recibir valores únicos. Los comandos concurrentes comparten el intento de conexión y reutilizan el cliente durante reconexión.
- `MqttTopicContract` genera publicación/suscripciones y extrae la identidad con el mismo prefijo. Rechaza tópicos ajenos o malformados antes de consultar la BD. Los identificadores usados en MQTT deben cumplir `[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}`; no se normalizan ni se reescriben IDs persistidos.
- El subscriber selecciona el parser de payload por tipo de tópico y respeta `MQTT_SHELLY_SWITCH_ID` en las rutas y eventos. Mantiene la conversión de energía Shelly Wh → kWh existente.
- Se conservan QoS 1 y `retain: false` para comandos. `COMMAND_PUBLISHED` sigue significando publicación, no confirmación física. Los errores de transporte/procesamiento se registran con códigos fijos, sin mensajes crudos de broker o consultas.

## Configuración y tópicos

Ejemplo de contrato para un entorno futuro; el dominio es reservado para documentación y no es un servidor desplegado:

```dotenv
NODE_ENV=production
MQTT_BROKER_URL=mqtts://broker.example.test:8883
MQTT_TOPIC_NAMESPACE=smarthome/production/v1
# MQTT_USERNAME y MQTT_PASSWORD: inyectar la identidad del servicio desde secretos.
# MQTT_TLS_CA_FILE: opcional, ruta a bundle PEM de confianza montado en runtime.
# MQTT_CLIENT_ID / MQTT_STATUS_CLIENT_ID: omitir o asignar IDs distintos por réplica.
```

La configuración completa también requiere las variables de BD, JWT y HTTPS/CORS de HU09. Este bloque no es un `.env` ejecutable. No copiar las credenciales de servicio al móvil, la web o los dispositivos.

Con `N = MQTT_TOPIC_NAMESPACE` e `I = manufacturerDeviceId`:

| Uso | Namespace configurado | Local sin namespace |
| --- | --- | --- |
| Control contrato interno | `N/devices/I/control` | `smarthome/devices/I/control` |
| Estado contrato interno | `N/devices/I/status` | `smarthome/devices/I/status` |
| Shelly RPC de control | `N/devices/I/rpc` | `I/rpc` |
| Shelly componente | `N/devices/I/status/switch:0` | `I/status/switch:0` |
| Shelly eventos | `N/devices/I/events/rpc` | `I/events/rpc` |
| Shelly `src` predeterminado | `N/backend` | `smarthome-backend` |

Los filtros de estado sustituyen únicamente `I` por `+`. No se suscribe a `#` ni se acepta automáticamente el tópico antiguo cuando hay namespace. `switch:0` usa el componente configurado si se cambia `MQTT_SHELLY_SWITCH_ID`; esto no demuestra compatibilidad física con otros componentes.

`MQTT_TOPIC_NAMESPACE` admite hasta 128 caracteres ASCII alfanuméricos, guiones y niveles `/` no vacíos. No debe comenzar con `$` ni incluir comodines. Es un prefijo por instalación/entorno; no sustituye autenticación, pertenencia al hogar o ACL del broker. La identidad global del dispositivo sigue siendo el ID sin prefijo.

`MQTT_SHELLY_RPC_SOURCE` puede configurarse dentro de `N/backend` (o subrutas). Shelly usa `<src>/rpc` para respuestas según su contrato; este incremento no consume ni correlaciona esas respuestas. Confirmación/rechazo de comandos y timeout funcional pertenecen al trabajo posterior HU13.

## Compatibilidad y alta

1. Sin namespace, el prefijo interno sigue siendo `smarthome/devices`, o el `MQTT_CONTROL_TOPIC_PREFIX` local existente. El mismo prefijo se usa ahora al leer estado.
2. Los overrides `MQTT_STATUS_TOPIC_FILTER`, `MQTT_SHELLY_SWITCH_TOPIC_FILTER` y `MQTT_SHELLY_RPC_EVENTS_TOPIC_FILTER` solo se aceptan si coinciden exactamente con el contrato derivado. Antes de activar namespace se deben retirar o actualizar también `MQTT_CONTROL_TOPIC_PREFIX` y `MQTT_SHELLY_RPC_SOURCE`. Un conflicto detiene el arranque; no amplía las suscripciones.
3. Cambiar namespace requiere coordinar prefijos del equipo, backend y ACL. Este incremento no reconfigura equipos ni migra mensajes retenidos. Una instalación existente podría dejar de recibir estado/control si se cambia solo un lado.
4. El endpoint LAN heredado `POST /api/v1/homes/:homeId/shelly/provision` devuelve `503 MQTT_DEVICE_BOOTSTRAP_REQUIRED` con TLS o namespace, antes de identificar/reconfigurar el equipo. El flujo antiguo distribuye la credencial global del backend y no implementa configuración TLS segura del equipo. Por eso no se usa como bootstrap cloud. JWT y permisos existentes permanecen; el bloqueo global no consulta información del hogar.
5. El modo TCP sin namespace conserva el comportamiento LAN anterior. La protección local de discovery/identify y validación RPC de HU13 está en otra copia de trabajo y **todavía no forma parte de `10-dev`**. Integrarla antes de desplegar; esta rama aislada no es candidata a producción.
6. El simulador `scripts/simulate-device.js` conserva su alcance local; no se ejecutó ni se adaptó como cliente cloud.

## Base de datos e integración

No se cambian Prisma, tablas, funciones RLS, índices ni changesets Liquibase. La consulta de ingestión sigue buscando un dispositivo activo/no eliminado por `manufacturer_device_id`. El namespace se elimina al interpretar el tópico; nunca se almacena en el ID ni se cambia su unicidad. Consultar el documento homónimo en `smarthome-database` / `10-dev`.

Se preservaron los cambios sin commit de `13-dev` en las carpetas originales. Esta rama parte de HU09, por lo que no incluye los cambios HU16 de permisos/históricos (`bc9d3ec` backend, `07de82f` y `c23c7f3` BD). La integración futura debe conservarlos y reconciliar las modificaciones concurrentes de configuración, módulo y provisioning de HU13.

## Validación ejecutada

| Comprobación | Resultado |
| --- | --- |
| `npm test -- --runInBand` | 155 pruebas, 6 suites aprobadas (82 de la base + 73 nuevas) |
| `npm run test:e2e -- --runInBand --runTestsByPath test/mqtt-namespace-security.e2e-spec.ts` | 31 pruebas aprobadas |
| `npm run build` | Aprobado |
| `tsc --noEmit` | Aprobado |
| ESLint sobre los 12 archivos TypeScript cambiados | Aprobado |

La suite de integración instancia adaptadores reales con transporte MQTT y repositorio simulados. Comprueba opciones TLS, tópicos/control, rechazo antes de BD, parsing según ruta, reconexión, concurrencia, expiración de conexión, redacción de errores y bloqueo del provisioning inseguro. El repositorio simulado retorna sin dispositivo; no valida persistencia, RLS ni el ciclo de consumo. La prueba CA utiliza un certificado público de Node en un archivo temporal y lo elimina después.

No se leyó `.env` real para las pruebas. No se conectó a broker, DB, Shelly ni cloud. La suite no prueba handshake TLS, rechazo de certificados por un broker real, ACL, retransmisiones/duplicidad, aislamiento entre usuarios, latencias ni relé físico.

## Pendientes para cerrar HU10/BD-07

- Elegir proveedor, región, presupuesto, broker, DNS y gestión de certificados/secretos (BD-06). No se inventaron destinos ni se contrató infraestructura.
- Configurar broker sin anónimo, permisos del servicio y de cada equipo, y probar aislamiento A/B y revocación con identidades simuladas (HU11). El namespace por sí solo no autentica el emisor de un mensaje.
- Definir bootstrap individual y posesión con móvil (HU12); validar firmware, CA y prefijo con el único Shelly disponible (HU13). Según documentación Shelly, su TLS usa `ssl_ca`; no asumir que configurar `mqtts://` en Nest activa TLS en el equipo.
- Probar certificado válido, CA no confiable, nombre incorrecto, reconexión y control/telemetría fuera de LAN en entorno autorizado. Definir tratamiento de duplicados QoS 1 y despliegue de varias instancias de ingestión antes de escalar.

## Referencias técnicas consultadas

- [MQTT.js: opciones de conexión y TLS](https://github.com/mqttjs/MQTT.js#connect), contrastadas con `node_modules/mqtt` instalado.
- [Shelly MQTT: prefijo, notificaciones y opciones de CA](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Mqtt/).
- [Shelly RPC sobre MQTT: solicitudes y respuestas](https://shelly-api-docs.shelly.cloud/gen2/General/RPCChannels/#mqtt).

Las referencias describen contratos técnicos; no son evidencia de prueba del hardware disponible.
