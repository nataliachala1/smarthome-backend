export class HomeHasDevicesError extends Error {
  constructor() {
    super('No se puede eliminar el hogar porque tiene dispositivos asociados');
  }
}