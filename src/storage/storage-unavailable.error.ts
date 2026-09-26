export class StorageUnavailableError extends Error {
  constructor(message = 'Storage unavailable') {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}
