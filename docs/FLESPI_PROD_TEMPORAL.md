# Flespi temporal para SmartHome PROD (NO desplegado)

## Objetivo

Modo temporal **exclusivo** de Flespi para un Ãºnico Shelly en PROD. Reutiliza `MqttRuntimeService`, `MqttDeviceStatusSubscriber`, el publicador de control, el parser, deduplicaciÃ³n SQL035/036 y la reconciliaciÃ³n existentes en DEV. No instala Mosquitto nuevo.

## Condiciones obligatorias

- Mantener `APP_ENV=production`, `NODE_ENV=production` y PostgreSQL `smarthome` de PROD.
- Credenciales Flespi ACL **distintas** de las de DEV, con permisos de tÃ³picos exactos, jamÃ¡s el token administrador.
- El Shelly actual apunta a `smarthome/dev/v1`. Se conserva **temporalmente** hasta su reconfiguraciÃ³n fÃ­sica. Eso NO separa el broker por tÃ³picos: la separaciÃ³n en la transiciÃ³n es por token ACL, base de datos y apagado de control DEV.
- No activar PROD como controlador hasta haber deshabilitado de forma comprobable el publicador Flespi DEV.
- Mantener una sola rÃ©plica para cualquier worker periÃ³dico de estado; comprobar en Docker Swarm.
- No copiar `mqtt_identity`, `mqtt_pairing_operation`, pairing sessions, JWT ni credenciales desde DEV.

## Variables para Backend PROD (solo tras revisiÃ³n y pruebas)

```dotenv
NODE_ENV=production
APP_ENV=production
MQTT_ENABLED=true
MQTT_BROKER_PROVIDER=flespi
MQTT_BROKER_URL=mqtts://mqtt.flespi.io:8883
MQTT_TOPIC_NAMESPACE=smarthome/dev/v1
MQTT_FLESPI_DEVICE_ID=shelly1pmg4-d885acf06990
MQTT_USERNAME=<TOKEN_ACL_PROD_ALMACENADO_EN_DOKPLOY>
MQTT_PASSWORD=
MQTT_TLS_CA_FILE=
MQTT_TLS_REJECT_UNAUTHORIZED=true
FLESPI_MQTT_PROD_TEMP_ENABLED=true
FLESPI_MQTT_PROD_CONTROL_ENABLED=false
FLESPI_MQTT_PROD_HANDOFF_ACK=false
FLESPI_MQTT_PROD_STATE_SYNC_ENABLED=false
SHELLY_FLESPI_STATE_SYNC_SINGLE_REPLICA=true
```

Las URLs `DATABASE_URL` y `DATABASE_IOT_URL` **se conservan** con sus logins separados y `sslmode=verify-full`, apuntando ambas a la DB PROD `/smarthome`.

## ACL mÃ­nima sugerida para token PROD

Revisar sintaxis/permisos efectivos en Flespi, **sin inventar grants**:

- SUBSCRIBE: `smarthome/dev/v1/devices/shelly1pmg4-d885acf06990/status/switch:0`
- SUBSCRIBE: `smarthome/dev/v1/devices/shelly1pmg4-d885acf06990/events/rpc`
- SUBSCRIBE: `smarthome/dev/v1/backend/shelly1pmg4-d885acf06990/rpc` (consulta de estado, si worker habilitado)
- PUBLISH: `smarthome/dev/v1/devices/shelly1pmg4-d885acf06990/rpc` (consulta y control, solo tras cutover)

No usar `#` o `+` como autorizaciones generales. El token con permiso PUBLISH ya podrÃ­a mandar Ã³rdenes fuera del backend: resguardarlo hasta la transferencia.

## Proceso de traspaso (requiere validaciÃ³n humana)

1. Obtener respaldo de configuraciÃ³n DEV y un inventario de estado real del Shelly en Flespi.
2. Crear token ACL PROD de mÃ­nimo privilegio sin reutilizar ni divulgar el token DEV.
3. Desplegar la rama en laboratorio y probar compilaciÃ³n, Jest, autorizaciÃ³n, TLS y conectividad sin enviar comandos.
4. Detener y verificar las rutas de control desde DEV hacia Flespi **sin apagar la web PROD ni la BD DEV**. Desactivar el perfil paralelo y confirmar que no queden conexiones de control activas; registrar evidencia.
5. Configurar PROD inicialmente con `FLESPI_MQTT_PROD_CONTROL_ENABLED=false`; habilitar lectura y validar el Shelly y los mensajes.
6. Registrar en `Apartamento1` mediante flujo OWNER autorizado solamente despuÃ©s de revisar colisiones y contrato. Si la vinculaciÃ³n formal exige prueba Mosquitto, no falsificar estados; documentar una ruta temporal auditable separada y validada.
7. Tras confirmar exclusividad de control, activar `FLESPI_MQTT_PROD_HANDOFF_ACK=true` y `FLESPI_MQTT_PROD_CONTROL_ENABLED=true`; comprobar permisos y una prueba fÃ­sica autorizada con un circuito seguro.
8. Validar `/health/live`, `/health/ready`, estado, consumo y Socket.IO. No reportar Ã©xito antes de ver el estado fÃ­sico y persistencia real.

## Rollback

Poner `FLESPI_MQTT_PROD_CONTROL_ENABLED=false`, redeploy controlado, confirmar cese de publicaciones, desactivar `FLESPI_MQTT_PROD_STATE_SYNC_ENABLED`, y solo despuÃ©s restaurar DEV si corresponde. No eliminar dispositivos ni tokens antes de constatar la transiciÃ³n segura.

## Limitaciones

- Este parche **no crea ni prueba** un flujo completo de adopciÃ³n de un Shelly fÃ­sico previamente registrado en DEV; debe validarse por separado.
- No automatiza la revocaciÃ³n en Flespi ni desactiva DEV. La bandera `HANDOFF_ACK` es una declaraciÃ³n del operador y no una prueba automÃ¡tica de exclusividad.
- La conexiÃ³n fÃ­sica actual puede estar OFFLINE aunque Flespi haya conectado antes; no inferir disponibilidad por logs histÃ³ricos.
- No hay separaciÃ³n de namespace MQTT fÃ­sico hasta reconfigurar Shelly. Planear migraciÃ³n a `smarthome/prod/v1` en Mosquitto definitivo.