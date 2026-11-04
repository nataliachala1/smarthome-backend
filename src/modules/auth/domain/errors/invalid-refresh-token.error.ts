export class InvalidRefreshTokenError extends Error {
  constructor(
    message = 'Refresh token inválido o expirado',
  ) {
    super(message);
    this.name = 'InvalidRefreshTokenError';
  }
}