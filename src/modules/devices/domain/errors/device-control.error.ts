export class DeviceCannotBeControlledError extends Error {
  constructor() {
    super('El dispositivo no puede ser controlado en este momento');
  }
}

export class DeviceOfflineForControlError extends Error {
  constructor() {
    super('El dispositivo está desconectado y no puede recibir comandos');
  }
}

export class DeviceControlNotConfiguredError extends Error {
  constructor() {
    super('El dispositivo no tiene configuración válida para control remoto');
  }
}

export class DeviceControlPublisherUnavailableError extends Error {
  constructor() {
    super('El publicador MQTT de control de dispositivos aún no está configurado');
  }
}