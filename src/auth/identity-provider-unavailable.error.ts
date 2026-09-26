export class IdentityProviderUnavailableError extends Error {
  constructor(message = 'Identity provider unavailable') {
    super(message);
    this.name = 'IdentityProviderUnavailableError';
  }
}
