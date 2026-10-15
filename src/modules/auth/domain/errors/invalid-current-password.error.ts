export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super('La contraseña actual es incorrecta');
  }
}