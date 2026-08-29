import { CatalogClient } from '../ports/catalog-client.port';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';

export class HttpCatalogClient implements CatalogClient {
  constructor(private readonly catalogBaseUrl: string) {}

  async createProcessingRequest(
    ownerUserId: string,
    sourceStorageKey: string,
  ): Promise<{ processingRequestId: string; status: string }> {
    let response: Response;
    try {
      response = await fetch(`${this.catalogBaseUrl}/processing-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerUserId, sourceStorageKey }),
      });
    } catch {
      throw new CatalogUnavailableError();
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new CatalogUnavailableError();
    }

    if (!response.ok || !this.isValidResponse(data)) {
      throw new CatalogUnavailableError();
    }

    return data;
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
