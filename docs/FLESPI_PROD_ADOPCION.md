# Adopción temporal Flespi — corrección del PR #29 (NO desplegada)

## Qué implementa

Añade un endpoint NestJS **exclusivo de un único Shelly preconfigurado** en PROD para crear el registro `devices.device` en un hogar existente. No sustituye el emparejamiento MQTT individual definitivo mediante Mosquitto y no modifica `mqtt_identity`, `mqtt_pairing_operation` ni ninguna sesión de pairing. El dispositivo se crea `OFFLINE`; el suscriptor y la reconciliación deberán comprobar y reflejar ONLINE con tráfico real.

El endpoint necesita `JwtAuthGuard`, autorización `OWNER` con RLS y una respuesta RPC fresca a `Switch.GetStatus` correlacionada por el cliente MQTT existente. Las ACL exactas, el token Flespi limitado y la transferencia exclusiva de DEV deben verificarse **operativamente**. Una respuesta RPC auténtica a nivel de protocolo no equivale a prueba de una identidad MQTT individual verificada por el broker.

## Ruta nueva

`POST /api/v1/homes/:homeId/devices/flespi-temp/adopt`

- Requiere JWT de OWNER de ese hogar y un UUID `homeId` válido.
- No recibe cuerpo, identidad de fabricante, secretos, ni identificadores físicos desde HTTP. Usa la identidad fijada en `MQTT_FLESPI_DEVICE_ID`.
- Nombre del dispositivo registrado: `Luz`; transporte `WIFI`; mensajería `MQTT`.
- Error `FLESPI_TEMP_ADOPTION_DISABLED` si el perfil, bandera de adopción o handoff no están habilitados.
- Error `FLESPI_TEMP_DEVICE_NOT_VERIFIED` si no hay respuesta RPC fresca; **no inserta** datos en ese caso.
- Ante nombre o fabricante duplicado conserva el manejo de conflicto de `CreateDeviceUseCase`, con unicidad de PostgreSQL. No declarar el dispositivo ONLINE por el alta.

## Variables nuevas del paquete

```dotenv
FLESPI_MQTT_PROD_DATABASE_HOST=smart-home-smarthomepostgres-l3s1t5
FLESPI_MQTT_PROD_ADOPTION_ENABLED=false
```

`FLESPI_MQTT_PROD_DATABASE_HOST` es un **pin del host PostgreSQL de PROD** y debe coincidir exactamente con `DATABASE_URL` y `DATABASE_IOT_URL` (ambos con base `/smarthome`, puerto `5432`, verificación `sslmode=verify-full`, sin parámetros extras, usuarios distintos). Si el despliegue real usa otro nombre o la verificación TLS existente no cumple estas condiciones, **no forzar el cambio**: revisar certificados y el contrato antes de activar Flespi.

Las banderas existentes del PR #29 mantienen el perfil apagado de forma predeterminada. La adopción temporal solo se permite con `FLESPI_MQTT_PROD_TEMP_ENABLED=true`, `FLESPI_MQTT_PROD_HANDOFF_ACK=true` y `FLESPI_MQTT_PROD_ADOPTION_ENABLED=true`; el control del relé puede continuar desactivado (`FLESPI_MQTT_PROD_CONTROL_ENABLED=false`).

## Advertencia crítica: ACL de consulta RPC

Para realizar `Switch.GetStatus`, el backend debe **publicar** en:

`smarthome/dev/v1/devices/shelly1pmg4-d885acf06990/rpc`

y suscribirse al menos a:

`smarthome/dev/v1/backend/shelly1pmg4-d885acf06990/rpc`

El mismo tópico de publicación admite también `Switch.Set`. Por tanto, **una ACL MQTT no puede distinguir consulta de control** dentro del JSON. El bloqueo `FLESPI_MQTT_PROD_CONTROL_ENABLED=false` protege la ruta normal HTTP; no convierte el token de broker en un token criptográficamente "solo lectura". No conceder PUBLISH al token PROD hasta completar el traspaso desde DEV y asegurarse de que el token esté protegido.

Para estado y telemetría, el cliente de backend debe además suscribirse a:

- `smarthome/dev/v1/devices/shelly1pmg4-d885acf06990/status/switch:0`
- `smarthome/dev/v1/devices/shelly1pmg4-d885acf06990/events/rpc`

No utilizar `#` ni permisos globales, ni copiar el token DEV.

## Secuencia segura de despliegue

1. Verificar CI y pruebas locales en la rama, sin tocar el VPS.
2. Confirmar que los nombres de host, certificados y roles reales PostgreSQL PROD son compatibles con el pin; mantener `MQTT_ENABLED=false` hasta entonces.
3. Preparar token Flespi de PROD con permiso exclusivamente sobre un Shelly. Verificar su alcance efectivo en un laboratorio.
4. Planificar ventana de transferencia; desactivar control **y conexiones Flespi del backend DEV** y comprobar que no se reestablecen. Registrar evidencia y garantizar que el dispositivo físico no esté manipulando una carga peligrosa.
5. Activar perfil Flespi PROD con `FLESPI_MQTT_PROD_CONTROL_ENABLED=false` y `FLESPI_MQTT_PROD_ADOPTION_ENABLED=false`, comprobar conexiones/subscripciones sin escribir datos de adopción.
6. Habilitar permisos RPC y marcar el handoff confirmado solamente después del corte. Activar `FLESPI_MQTT_PROD_ADOPTION_ENABLED=true` por una ventana corta.
7. Invocar el nuevo POST autenticado desde un cliente legítimo (no compartir tokens JWT). Verificar que responde `integrationMode=FLESPI_TEMPORARY`, `officialPairingCompleted=false`, y `connectivityStatus=OFFLINE` inicialmente. Desactivar inmediatamente la bandera de adopción para evitar futuras altas.
8. Habilitar el worker de reconciliación de estado únicamente si se comprueba una sola réplica del backend y autorización de tópicos, y validar telemetría y Socket.IO. Prueba de control físico solo en una ventana expresamente autorizada.
9. Verificar que no existen dispositivos duplicados y que `Luz` está asociado a `Apartamento1` PROD. No simular identidad `mqtt_identity` ni completar sesión de pairing.

## Rollback

Desactivar `FLESPI_MQTT_PROD_CONTROL_ENABLED`, `FLESPI_MQTT_PROD_ADOPTION_ENABLED` y el worker, reiniciar el servicio tras validar cambios. Detener y comprobar conexiones de PROD antes de reactivar DEV. No borrar automáticamente la fila de dispositivo ni sesiones, y no revocar credenciales sin una comprobación de las consecuencias.

## Pendiente para certificación definitiva

- Autenticación y provisión individual verificable por broker MQTT para este Shelly.
- Migración controlada a Mosquitto PROD con `smarthome/prod/v1`.
- Pruebas físicas y de ACL contra el broker real.
- Revisar RLS y unicidad de `manufacturer_device_id` en PostgreSQL PROD; **un test unitario no reemplaza el ensayo de concurrencia en una BD desechable**.
