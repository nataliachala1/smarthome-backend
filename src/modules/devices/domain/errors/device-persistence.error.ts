export class DeviceAccessDeniedError extends Error {
  constructor() {
    super('No tienes permisos sobre los dispositivos de este hogar');
  }
}
export class DeviceConflictError extends Error {
  constructor() {
    super('Ya existe un dispositivo con ese nombre o identificador');
  }
}
export class InvalidDeviceReferenceError extends Error {
  constructor() {
    super('El hogar o tipo de dispositivo no está disponible');
  }
}
