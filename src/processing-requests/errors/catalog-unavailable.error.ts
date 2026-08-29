export class CatalogUnavailableError extends Error {
  constructor(message = 'Catalog unavailable') {
    super(message);
    this.name = 'CatalogUnavailableError';
  }
}
