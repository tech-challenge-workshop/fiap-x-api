import {
  CatalogArchive,
  CatalogClient,
  CatalogCreateOutcome,
  CatalogOwnedItem,
  CatalogOwnedPage,
} from '../ports/catalog-client.port';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';

export class HttpCatalogClient implements CatalogClient {
  constructor(private readonly catalogBaseUrl: string) {}

  async createProcessingRequest(
    ownerUserId: string,
    sourceStorageKey: string,
    idempotencyKey: string,
  ): Promise<CatalogCreateOutcome> {
    const { status, data } = await this.request(
      `${this.catalogBaseUrl}/processing-requests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerUserId, sourceStorageKey, idempotencyKey }),
      },
    );
    if (status === 409) {
      return { outcome: 'conflict' };
    }
    if ((status !== 201 && status !== 200) || !this.isValidResponse(data)) {
      throw new CatalogUnavailableError();
    }
    return {
      outcome: status === 201 ? 'created' : 'replayed',
      processingRequestId: data.processingRequestId,
      status: data.status,
    };
  }

  async getArchive(
    ownerUserId: string,
    processingRequestId: string,
  ): Promise<CatalogArchive | undefined> {
    const { status, data } = await this.request(
      `${this.ownedPath(ownerUserId)}/${encodeURIComponent(processingRequestId)}/archive`,
    );
    if (status === 404) {
      return undefined;
    }
    if (status === 409) {
      return 'not-completed';
    }
    if (
      status !== 200 ||
      !isRecord(data) ||
      typeof data.zipStorageKey !== 'string' ||
      data.zipStorageKey === ''
    ) {
      throw new CatalogUnavailableError();
    }
    return { zipStorageKey: data.zipStorageKey };
  }

  async listOwned(
    ownerUserId: string,
    page: number,
    pageSize: number,
  ): Promise<CatalogOwnedPage> {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    const { status, data } = await this.request(
      `${this.ownedPath(ownerUserId)}?${query.toString()}`,
    );
    if (status !== 200 || !isOwnedPage(data)) {
      throw new CatalogUnavailableError();
    }
    return data;
  }

  async getOwned(
    ownerUserId: string,
    processingRequestId: string,
  ): Promise<CatalogOwnedItem | undefined> {
    const { status, data } = await this.request(
      `${this.ownedPath(ownerUserId)}/${encodeURIComponent(processingRequestId)}`,
    );
    if (status === 404) {
      return undefined;
    }
    if (status !== 200 || !isOwnedItem(data)) {
      throw new CatalogUnavailableError();
    }
    return data;
  }

  private ownedPath(ownerUserId: string): string {
    return `${this.catalogBaseUrl}/owners/${encodeURIComponent(ownerUserId)}/processing-requests`;
  }

  /** Any network or JSON failure is the Catalog being unavailable. */
  private async request(
    url: string,
    init?: RequestInit,
  ): Promise<{ status: number; data: unknown }> {
    try {
      const response = await fetch(url, init);
      return { status: response.status, data: await response.json() };
    } catch {
      throw new CatalogUnavailableError();
    }
  }

  private isValidResponse(
    data: unknown,
  ): data is { processingRequestId: string; status: string } {
    return (
      typeof data === 'object' &&
      data !== null &&
      'processingRequestId' in data &&
      'status' in data &&
      typeof (data as Record<string, unknown>).processingRequestId ===
        'string' &&
      typeof (data as Record<string, unknown>).status === 'string'
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOwnedItem(value: unknown): value is CatalogOwnedItem {
  return (
    isRecord(value) &&
    typeof value.processingRequestId === 'string' &&
    typeof value.status === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    (value.failureReason === undefined ||
      typeof value.failureReason === 'string')
  );
}

function isOwnedPage(value: unknown): value is CatalogOwnedPage {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isOwnedItem) &&
    typeof value.page === 'number' &&
    typeof value.pageSize === 'number' &&
    typeof value.total === 'number'
  );
}
