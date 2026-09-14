# Contrato MQTT - Smart Home

Este documento define los topicos, comandos y payloads MQTT utilizados entre el backend Smart Home y los dispositivos IoT compatibles con el contrato interno de la aplicacion.

El archivo `.env` del backend ya debe tener configuradas las variables necesarias para conectarse al broker MQTT.

## 1. Broker MQTT

En entorno local se usa Mosquitto en el puerto `1883`.

Ejemplo de conexion local:

```env
MQTT_BROKER_URL=mqtt://localhost:1883
```

Variables soportadas por el backend:

```env
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_CLIENT_ID=smarthome-backend
MQTT_STATUS_CLIENT_ID=smarthome-backend-status
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_CONTROL_TOPIC_PREFIX=smarthome/devices
MQTT_STATUS_TOPIC_FILTER=smarthome/devices/+/status
```

El backend y los dispositivos deben conectarse al mismo broker MQTT.

## 2. Identificador del dispositivo

Cada dispositivo debe tener un `manufacturerDeviceId` unico.

Ejemplo:

```text
Lampara-sala-001
```

Este valor debe coincidir con el campo `manufacturerDeviceId` registrado en Smart Home.

El backend utiliza este identificador para relacionar los mensajes MQTT con el dispositivo almacenado en PostgreSQL.

## 3. Topico de control

El backend publica comandos en:

```text
smarthome/devices/{manufacturerDeviceId}/control
```

Ejemplo:

```text
smarthome/devices/Lampara-sala-001/control
```

Configuracion usada:

```text
QoS: 1
Retain: false
```

## 4. Payload de control

### Encender dispositivo

```json
{
  "command": "TURN_ON",
  "homeId": "UUID_DEL_HOGAR",
  "deviceId": "UUID_DEL_DISPOSITIVO",
  "manufacturerDeviceId": "Lampara-sala-001",
  "sentAt": "2026-09-14T13:31:48.015Z"
}
```

### Apagar dispositivo

```json
{
  "command": "TURN_OFF",
  "homeId": "UUID_DEL_HOGAR",
  "deviceId": "UUID_DEL_DISPOSITIVO",
  "manufacturerDeviceId": "Lampara-sala-001",
  "sentAt": "2026-09-14T13:34:18.290Z"
}
```

Comandos soportados:

```text
TURN_ON
TURN_OFF
```

## 5. Topico de estado y telemetria

Los dispositivos publican su estado y telemetria en:

```text
smarthome/devices/{manufacturerDeviceId}/status
```

Ejemplo:

```text
smarthome/devices/Lampara-sala-001/status
```

El backend escucha por defecto:

```text
smarthome/devices/+/status
```

Configuracion usada:

```text
QoS: 1
```

## 6. Payload de estado

### Dispositivo encendido

```json
{
  "connectivityStatus": "ONLINE",
  "isOn": true,
  "currentPowerW": 17.95,
  "energyDeltaKwh": 0.0002,
  "energyTotalKwh": 1.2502,
  "voltageV": 120,
  "currentA": 0.1496,
  "frequencyHz": 60,
  "temperatureC": 35.25,
  "readAt": "2026-09-14T13:31:48.017Z"
}
```

### Dispositivo apagado

```json
{
  "connectivityStatus": "ONLINE",
  "isOn": false,
  "currentPowerW": 0,
  "energyDeltaKwh": 0,
  "energyTotalKwh": 1.2502,
  "voltageV": 120,
  "currentA": 0,
  "frequencyHz": 60,
  "temperatureC": null,
  "readAt": "2026-09-14T13:34:18.291Z"
}
```

## 7. Campos soportados en el payload de estado

### connectivityStatus

Estado de conexion del dispositivo.

Valores validos:

```text
ONLINE
OFFLINE
```

### isOn

Indica si el dispositivo esta encendido o apagado.

Tipo:

```text
boolean
```

### currentPowerW

Potencia instantanea en watts.

Tipo:

```text
number | null
```

### energyDeltaKwh

Energia consumida desde la lectura anterior.

Tipo:

```text
number | null
```

### energyTotalKwh

Contador acumulado de energia reportado por el dispositivo.

Tipo:

```text
number | null
```

### voltageV

Voltaje electrico.

Tipo:

```text
number | null
```

### currentA

Corriente electrica.

Tipo:

```text
number | null
```

### frequencyHz

Frecuencia electrica.

Tipo:

```text
number | null
```

### temperatureC

Temperatura reportada por el dispositivo.

Tipo:

```text
number | null
```

### readAt

Fecha y hora de la lectura en formato ISO 8601.

Ejemplo:

```text
2026-09-14T13:31:48.017Z
```

## 8. Procesamiento en el backend

Cuando el backend recibe un mensaje MQTT valido:

1. Extrae el `manufacturerDeviceId` desde el topico.
2. Busca el dispositivo activo correspondiente.
3. Actualiza el estado del dispositivo:
   - `connectivityStatus`
   - `isOn`
   - `currentPowerW`
4. Guarda la lectura de consumo cuando existe `currentPowerW`.
5. Actualiza las metricas de consumo.
6. Evalua posibles anomalias de consumo.
7. Confirma la transaccion en PostgreSQL.
8. Emite eventos realtime mediante Socket.IO.

Los eventos realtime se emiten despues de finalizar correctamente la transaccion de base de datos.

Eventos realtime utilizados:

```text
device.status.updated
consumption.created
notification.created
notification.unread_count.updated
```

## 9. Flujo general

```text
Frontend / Swagger
        |
        v
      NestJS
        |
        v
     Mosquitto
        |
        v
 Dispositivo IoT
        |
        v
     Mosquitto
        |
        v
      NestJS
        |
        v
   PostgreSQL
        |
        v
    Socket.IO
        |
        v
     Frontend
```

## 10. Simulador de dispositivo

El backend incluye un simulador MQTT:

```text
scripts/simulate-device.js
```

Se ejecuta con:

```bash
npm run simulate:device
```

Por defecto utiliza:

```text
manufacturerDeviceId = Lampara-sala-001
broker = mqtt://localhost:1883
```

El simulador:

- se conecta al broker MQTT;
- escucha comandos `TURN_ON` y `TURN_OFF`;
- publica estado del dispositivo;
- simula potencia, energia, corriente y temperatura.

## 11. Ejemplo de prueba local

Primero levantar PostgreSQL y Mosquitto desde el repositorio de base de datos.

Luego iniciar el backend:

```bash
npm run start:dev
```

Despues iniciar el simulador:

```bash
npm run simulate:device
```

El simulador debe mostrar algo parecido a:

```text
[SIM] Conectado a mqtt://localhost:1883
[SIM] Escuchando control en smarthome/devices/Lampara-sala-001/control
[SIM] Publicando estado en smarthome/devices/Lampara-sala-001/status
```

El backend debe mostrar algo parecido a:

```text
Suscrito a topico MQTT de estado: smarthome/devices/+/status
Estado MQTT actualizado para Lampara-sala-001. Consumo guardado=true
```

## 12. Dispositivos fisicos

Este documento describe el contrato MQTT interno de Smart Home.

Un dispositivo fisico que utilice un protocolo MQTT propio del fabricante puede requerir una capa de adaptacion.

El adaptador debe transformar el estado del dispositivo hacia este topico:

```text
smarthome/devices/{manufacturerDeviceId}/status
```

y debe transformar los comandos internos:

```text
TURN_ON
TURN_OFF
```

al protocolo de control especifico del fabricante.

## 13. Nota sobre Shelly 1PM Gen4

Shelly 1PM Gen4 puede comunicarse por MQTT, pero sus topicos y payloads nativos no necesariamente coinciden directamente con este contrato interno.

Para integrarlo se debe validar su configuracion MQTT y, si es necesario, implementar una capa de traduccion entre:

```text
Protocolo MQTT Shelly
```

y:

```text
Contrato MQTT Smart Home
```

El backend actual ya esta listo para recibir mensajes en el contrato interno definido en este documento.