import {
  CatalogArchive,
  CatalogClient,
  CatalogCreateOutcome,
  CatalogOwnedItem,
  CatalogOwnedPage,
} from '../ports/catalog-client.port';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';

interface StoredRequest extends CatalogOwnedItem {
  ownerUserId: string;
  sourceStorageKey: string;
  idempotencyKey: string;
  zipStorageKey?: string;
}

/**
 * Test double and local fallback for the Catalog. Like the real Catalog's
 * creation response, every answer carries the whole stored record, internal
 * fields included, so the API's projection is what keeps them out of
 * responses.
 */
export class InMemoryCatalogClient implements CatalogClient {
  private idSequence = 0;
  private shouldReject = false;
  private readonly requests: StoredRequest[] = [];

  setNextRequestShouldReject(value: boolean): void {
    this.shouldReject = value;
  }

  /**
   * Idempotent per `(owner, idempotencyKey)`, as the Catalog is: the same
   * key for the same source replays the request, for another source it is a
   * conflict.
   */
  createProcessingRequest(
    ownerUserId: string,
    sourceStorageKey: string,
    idempotencyKey: string,
  ): Promise<CatalogCreateOutcome> {
    if (this.shouldReject) {
      return Promise.reject(
        new CatalogUnavailableError('Catalog rejected creation'),
      );
    }

    const existing = this.requests.find(
      (request) =>
        request.ownerUserId === ownerUserId &&
        request.idempotencyKey === idempotencyKey,
    );
    if (existing) {
      return Promise.resolve(
        existing.sourceStorageKey === sourceStorageKey
          ? { ...existing, outcome: 'replayed' }
          : { outcome: 'conflict' },
      );
    }

    this.idSequence += 1;
    const now = new Date().toISOString();
    const request: StoredRequest = {
      processingRequestId: `pr-${ownerUserId}-${sourceStorageKey}-${this.idSequence}`,
      status: 'RECEIVED',
      ownerUserId,
      sourceStorageKey,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    this.requests.push(request);
    return Promise.resolve({ ...request, outcome: 'created' });
  }

  /** Stands in for the Worker moving a request along; tests only. */
  setStatus(
    processingRequestId: string,
    status: string,
    zipStorageKey?: string,
  ): void {
    const request = this.requests.find(
      (candidate) => candidate.processingRequestId === processingRequestId,
    );
    if (!request) {
      throw new Error(`Unknown processing request: ${processingRequestId}`);
    }
    request.status = status;
    request.zipStorageKey = zipStorageKey;
    request.updatedAt = new Date().toISOString();
  }

  getArchive(
    ownerUserId: string,
    processingRequestId: string,
  ): Promise<CatalogArchive | undefined> {
    if (this.shouldReject) {
      return Promise.reject(new CatalogUnavailableError());
    }
    const found = this.requests.find(
      (request) =>
        request.ownerUserId === ownerUserId &&
        request.processingRequestId === processingRequestId,
    );
    if (!found) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(
      found.status === 'COMPLETED' && found.zipStorageKey
        ? { zipStorageKey: found.zipStorageKey }
        : 'not-completed',
    );
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
