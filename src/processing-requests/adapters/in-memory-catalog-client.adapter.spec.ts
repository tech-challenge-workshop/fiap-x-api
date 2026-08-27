import { InMemoryCatalogClient } from './in-memory-catalog-client.adapter';

describe('InMemoryCatalogClient', () => {
  let adapter: InMemoryCatalogClient;

  beforeEach(() => {
    adapter = new InMemoryCatalogClient();
  });

  it('returns a processing request id for valid input', async () => {
    const id = await adapter.createProcessingRequest(
      'user-123',
      'videos/clip.mp4',
    );

    expect(id).toContain('user-123');
    expect(id).toContain('videos/clip.mp4');
  });

  it('returns deterministic sequential ids', async () => {
    const first = await adapter.createProcessingRequest('user-1', 'source-1');
    const second = await adapter.createProcessingRequest('user-2', 'source-2');

    expect(first).toBe('pr-user-1-source-1-1');
    expect(second).toBe('pr-user-2-source-2-2');
  });

  it('rejects when configured to reject', async () => {
    adapter.setNextRequestShouldReject(true);

    await expect(
      adapter.createProcessingRequest('user-123', 'videos/clip.mp4'),
    ).rejects.toThrow('Catalog rejected creation');
  });
});
