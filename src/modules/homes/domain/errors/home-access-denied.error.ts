export class HomeAccessDeniedError extends Error {
  constructor() {
    super('No tienes permisos para realizar esta operación en el hogar');
    this.name = 'HomeAccessDeniedError';
  }
}