import { CatalogClient } from '../ports/catalog-client.port';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';

export class InMemoryCatalogClient implements CatalogClient {
  private idSequence = 0;
  private shouldReject = false;

  setNextRequestShouldReject(value: boolean): void {
    this.shouldReject = value;
  }

  createProcessingRequest(
    ownerUserId: string,
    sourceStorageKey: string,
  ): Promise<{ processingRequestId: string; status: string }> {
    if (this.shouldReject) {
      return Promise.reject(
        new CatalogUnavailableError('Catalog rejected creation'),
      );
    }

    this.idSequence += 1;
    return Promise.resolve({
      processingRequestId: `pr-${ownerUserId}-${sourceStorageKey}-${this.idSequence}`,
      status: 'RECEIVED',
    });
  }
}
