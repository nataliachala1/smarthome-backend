const mqtt = require('mqtt');

const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const manufacturerDeviceId =
  process.env.MANUFACTURER_DEVICE_ID || 'Lampara-sala-001';

const topicPrefix = process.env.MQTT_CONTROL_TOPIC_PREFIX || 'smarthome/devices';

const controlTopic = `${topicPrefix}/${manufacturerDeviceId}/control`;
const statusTopic = `${topicPrefix}/${manufacturerDeviceId}/status`;

let isOn = false;
let energyTotalKwh = 1.25;

const client = mqtt.connect(brokerUrl, {
  clientId: `simulator-${manufacturerDeviceId}-${process.pid}`,
  clean: true,
  reconnectPeriod: 1000,
});

client.on('connect', () => {
  console.log(`[SIM] Conectado a ${brokerUrl}`);
  console.log(`[SIM] Escuchando control en ${controlTopic}`);
  console.log(`[SIM] Publicando estado en ${statusTopic}`);

  client.subscribe(controlTopic, { qos: 1 }, (error) => {
    if (error) {
      console.error('[SIM] Error suscribiendo control:', error.message);
      return;
    }

    publishStatus();
  });
});

client.on('message', (topic, payload) => {
  if (topic !== controlTopic) {
    return;
  }

  const rawPayload = payload.toString('utf8');
  console.log(`[SIM] Comando recibido: ${rawPayload}`);

  let message;

  try {
    message = JSON.parse(rawPayload);
  } catch {
    console.warn('[SIM] Payload invalido');
    return;
  }

  if (message.command === 'TURN_ON') {
    isOn = true;
    publishStatus();
    return;
  }

  if (message.command === 'TURN_OFF') {
    isOn = false;
    publishStatus();
    return;
  }

  console.warn(`[SIM] Comando no soportado: ${message.command}`);
});

client.on('error', (error) => {
  console.error('[SIM] Error MQTT:', error.message);
});

function publishStatus() {
  const currentPowerW = isOn ? randomBetween(12, 20) : 0;
  const energyDeltaKwh = isOn ? 0.0002 : 0;

  energyTotalKwh += energyDeltaKwh;

  const status = {
    connectivityStatus: 'ONLINE',
    isOn,
    currentPowerW,
    energyDeltaKwh,
    energyTotalKwh,
    voltageV: 120,
    currentA: isOn ? Number((currentPowerW / 120).toFixed(4)) : 0,
    frequencyHz: 60,
    temperatureC: isOn ? randomBetween(31, 36) : null,
    readAt: new Date().toISOString(),
  };

  client.publish(statusTopic, JSON.stringify(status), { qos: 1 }, (error) => {
    if (error) {
      console.error('[SIM] Error publicando estado:', error.message);
      return;
    }

    console.log('[SIM] Estado publicado:', status);
  });
}

function randomBetween(min, max) {
  return Number((Math.random() * (max - min) + min).toFixed(2));
}