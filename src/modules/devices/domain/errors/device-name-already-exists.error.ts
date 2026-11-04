export class DeviceNameAlreadyExistsError extends Error {
  constructor() {
    super('Ya existe un dispositivo activo con ese nombre en el hogar');
    this.name = 'DeviceNameAlreadyExistsError';
  }
}
