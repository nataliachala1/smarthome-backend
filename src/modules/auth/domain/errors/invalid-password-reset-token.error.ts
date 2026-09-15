export class InvalidPasswordResetTokenError extends Error {
  constructor() {
    super('El token de recuperación es inválido o expiró');
  }
}