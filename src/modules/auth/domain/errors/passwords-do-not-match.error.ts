export class PasswordsDoNotMatchError extends Error {
  constructor() {
    super('Las contraseñas no coinciden');
  }
}