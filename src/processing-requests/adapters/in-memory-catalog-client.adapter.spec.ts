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

  describe('owner-scoped reads', () => {
    it("never shows one owner the other owner's requests", async () => {
      const alices = await adapter.createProcessingRequest('alice', 'a.mp4');
      const bobs = await adapter.createProcessingRequest('bob', 'b.mp4');

      const alicePage = await adapter.listOwned('alice', 1, 20);
      const bobPage = await adapter.listOwned('bob', 1, 20);

      expect(alicePage.items.map((i) => i.processingRequestId)).toEqual([
        alices.processingRequestId,
      ]);
      expect(alicePage.total).toBe(1);
      expect(bobPage.items.map((i) => i.processingRequestId)).toEqual([
        bobs.processingRequestId,
      ]);
      await expect(
        adapter.getOwned('bob', alices.processingRequestId),
      ).resolves.toBeUndefined();
      await expect(
        adapter.getOwned('alice', bobs.processingRequestId),
      ).resolves.toBeUndefined();
    });

    it('lists newest first and pages with the true total', async () => {
      const ids: string[] = [];
      for (const key of ['1.mp4', '2.mp4', '3.mp4']) {
        ids.push(
          (await adapter.createProcessingRequest('alice', key))
            .processingRequestId,
        );
      }

      const first = await adapter.listOwned('alice', 1, 2);
      const second = await adapter.listOwned('alice', 2, 2);
      const beyond = await adapter.listOwned('alice', 3, 2);

      expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3 });
      expect(first.items.map((i) => i.processingRequestId)).toEqual([
        ids[2],
        ids[1],
      ]);
      expect(second.items.map((i) => i.processingRequestId)).toEqual([ids[0]]);
      expect(beyond).toEqual({ items: [], page: 3, pageSize: 2, total: 3 });
    });

    it("returns the owner's request by id, and undefined for an unknown id", async () => {
      const created = await adapter.createProcessingRequest('alice', 'a.mp4');

      const found = await adapter.getOwned(
        'alice',
        created.processingRequestId,
      );

      expect(found).toMatchObject({
        processingRequestId: created.processingRequestId,
        status: 'RECEIVED',
      });
      expect(typeof found?.createdAt).toBe('string');
      expect(typeof found?.updatedAt).toBe('string');
      await expect(
        adapter.getOwned('alice', 'unknown'),
      ).resolves.toBeUndefined();
    });

    it('rejects the reads with CatalogUnavailableError when configured to reject', async () => {
      adapter.setNextRequestShouldReject(true);

      await expect(adapter.listOwned('alice', 1, 20)).rejects.toThrow(
        CatalogUnavailableError,
      );
      await expect(adapter.getOwned('alice', 'any')).rejects.toThrow(
        CatalogUnavailableError,
      );
    });
  });
});
