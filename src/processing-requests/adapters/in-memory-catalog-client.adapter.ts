import {
  CatalogClient,
  CatalogOwnedItem,
  CatalogOwnedPage,
} from '../ports/catalog-client.port';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';

interface StoredRequest extends CatalogOwnedItem {
  ownerUserId: string;
  sourceStorageKey: string;
}

/**
 * Test double and local fallback for the Catalog. Reads return the whole
 * stored record, internal fields included, so the API's projection is what
 * keeps them out of responses.
 */
export class InMemoryCatalogClient implements CatalogClient {
  private idSequence = 0;
  private shouldReject = false;
  private readonly requests: StoredRequest[] = [];

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
    const now = new Date().toISOString();
    const request: StoredRequest = {
      processingRequestId: `pr-${ownerUserId}-${sourceStorageKey}-${this.idSequence}`,
      status: 'RECEIVED',
      ownerUserId,
      sourceStorageKey,
      createdAt: now,
      updatedAt: now,
    };
    this.requests.push(request);
    return Promise.resolve({
      processingRequestId: request.processingRequestId,
      status: request.status,
    });
  }

  listOwned(
    ownerUserId: string,
    page: number,
    pageSize: number,
  ): Promise<CatalogOwnedPage> {
    if (this.shouldReject) {
      return Promise.reject(new CatalogUnavailableError());
    }
    // Stored in creation order; reversed, newest first.
    const owned = this.requests
      .filter((request) => request.ownerUserId === ownerUserId)
      .reverse();
    const start = (page - 1) * pageSize;
    return Promise.resolve({
      items: owned.slice(start, start + pageSize).map((r) => ({ ...r })),
      page,
      pageSize,
      total: owned.length,
    });
  }

  getOwned(
    ownerUserId: string,
    processingRequestId: string,
  ): Promise<CatalogOwnedItem | undefined> {
    if (this.shouldReject) {
      return Promise.reject(new CatalogUnavailableError());
    }
    const found = this.requests.find(
      (request) =>
        request.ownerUserId === ownerUserId &&
        request.processingRequestId === processingRequestId,
    );
    return Promise.resolve(found && { ...found });
  }
}
