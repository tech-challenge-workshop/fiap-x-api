import { HttpCatalogClient } from './http-catalog-client.adapter';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';

describe('HttpCatalogClient', () => {
  const baseUrl = 'http://catalog:3001';
  let client: HttpCatalogClient;
  let fetchSpy: jest.SpyInstance<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >;

  beforeEach(() => {
    client = new HttpCatalogClient(baseUrl);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const successResponse = () =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          processingRequestId: 'pr-123',
          status: 'RECEIVED',
        }),
    } as unknown as Response);

  it('returns the catalog response on success', async () => {
    fetchSpy.mockResolvedValue(successResponse());

    const result = await client.createProcessingRequest('user-1', 'source-1');

    expect(result).toEqual({
      processingRequestId: 'pr-123',
      status: 'RECEIVED',
    });
    expect(fetchSpy).toHaveBeenCalledWith(`${baseUrl}/processing-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerUserId: 'user-1',
        sourceStorageKey: 'source-1',
      }),
    });
  });

  it('throws CatalogUnavailableError when fetch fails', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));

    await expect(
      client.createProcessingRequest('user-1', 'source-1'),
    ).rejects.toThrow(CatalogUnavailableError);
  });

  it('throws CatalogUnavailableError on non-2xx response', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      json: () =>
        Promise.resolve({
          processingRequestId: 'pr-123',
          status: 'RECEIVED',
        }),
    } as unknown as Response);

    await expect(
      client.createProcessingRequest('user-1', 'source-1'),
    ).rejects.toThrow(CatalogUnavailableError);
  });

  it('throws CatalogUnavailableError on malformed JSON response', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unexpected: 'shape' }),
    } as unknown as Response);

    await expect(
      client.createProcessingRequest('user-1', 'source-1'),
    ).rejects.toThrow(CatalogUnavailableError);
  });
});
