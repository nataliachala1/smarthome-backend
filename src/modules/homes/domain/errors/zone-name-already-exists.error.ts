export class ZoneNameAlreadyExistsError extends Error {
  constructor() {
    super('Ya existe una zona activa con ese nombre en el hogar');
    this.name = 'ZoneNameAlreadyExistsError';
  }
}