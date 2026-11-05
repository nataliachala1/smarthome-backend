export class InvalidActivationTokenError extends Error {
  constructor() {
    super('El token de activación es inválido o ha expirado');
    this.name = 'InvalidActivationTokenError';
  }
}