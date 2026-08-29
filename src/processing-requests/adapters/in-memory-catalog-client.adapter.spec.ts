import { InMemoryCatalogClient } from './in-memory-catalog-client.adapter';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';

describe('InMemoryCatalogClient', () => {
  let adapter: InMemoryCatalogClient;

  beforeEach(() => {
    adapter = new InMemoryCatalogClient();
  });

  it('returns a processing request id and RECEIVED status for valid input', async () => {
    const result = await adapter.createProcessingRequest(
      'user-123',
      'videos/clip.mp4',
    );

    expect(result.processingRequestId).toContain('user-123');
    expect(result.processingRequestId).toContain('videos/clip.mp4');
    expect(result.status).toBe('RECEIVED');
  });

  it('returns deterministic sequential ids', async () => {
    const first = await adapter.createProcessingRequest('user-1', 'source-1');
    const second = await adapter.createProcessingRequest('user-2', 'source-2');

    expect(first.processingRequestId).toBe('pr-user-1-source-1-1');
    expect(second.processingRequestId).toBe('pr-user-2-source-2-2');
  });

  it('rejects with CatalogUnavailableError when configured to reject', async () => {
    adapter.setNextRequestShouldReject(true);

    await expect(
      adapter.createProcessingRequest('user-123', 'videos/clip.mp4'),
    ).rejects.toThrow(CatalogUnavailableError);
  });
});
