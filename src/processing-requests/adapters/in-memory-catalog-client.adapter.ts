import { CatalogClient } from '../ports/catalog-client.port';

export class InMemoryCatalogClient implements CatalogClient {
  private idSequence = 0;
  private shouldReject = false;

  setNextRequestShouldReject(value: boolean): void {
    this.shouldReject = value;
  }

  createProcessingRequest(
    ownerUserId: string,
    sourceStorageKey: string,
  ): Promise<string> {
    if (this.shouldReject) {
      return Promise.reject(new Error('Catalog rejected creation'));
    }

    this.idSequence += 1;
    return Promise.resolve(
      `pr-${ownerUserId}-${sourceStorageKey}-${this.idSequence}`,
    );
  }
}
