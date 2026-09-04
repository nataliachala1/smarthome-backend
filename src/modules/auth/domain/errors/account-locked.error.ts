export class AccountLockedError extends Error {
  constructor() {
    super('La cuenta está temporalmente bloqueada');
    this.name = 'AccountLockedError';
  }
}