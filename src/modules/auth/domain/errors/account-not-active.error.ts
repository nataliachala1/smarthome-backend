export class AccountNotActiveError extends Error {
  constructor() {
    super('La cuenta no está activa');
    this.name = 'AccountNotActiveError';
  }
}