export class EmailAlreadyExistsError extends Error {
  constructor() {
    super('El correo electrónico ya está registrado');
    this.name = 'EmailAlreadyExistsError';
  }
}