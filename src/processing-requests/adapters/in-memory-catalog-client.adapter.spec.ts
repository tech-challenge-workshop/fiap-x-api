import { InMemoryCatalogClient } from './in-memory-catalog-client.adapter';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';

describe('InMemoryCatalogClient', () => {
  let adapter: InMemoryCatalogClient;

  beforeEach(() => {
    adapter = new InMemoryCatalogClient();
  });

  /** Creates with a key of its own and returns the new id. */
  let keySequence = 0;
  const createdId = async (owner: string, source: string): Promise<string> => {
    keySequence += 1;
    const result = await adapter.createProcessingRequest(
      owner,
      source,
      `idem-${keySequence}`,
    );
    if (result.outcome !== 'created') {
      throw new Error(`expected created, got ${result.outcome}`);
    }
    return result.processingRequestId;
  };

  it('returns a processing request id and RECEIVED status for valid input', async () => {
    const result = await adapter.createProcessingRequest(
      'user-123',
      'videos/clip.mp4',
      'idem-1',
    );

    expect(result).toMatchObject({ outcome: 'created', status: 'RECEIVED' });
    const { processingRequestId } = result as { processingRequestId: string };
    expect(processingRequestId).toContain('user-123');
    expect(processingRequestId).toContain('videos/clip.mp4');
  });

  it('returns deterministic sequential ids', async () => {
    const first = await adapter.createProcessingRequest(
      'user-1',
      'source-1',
      'idem-1',
    );
    const second = await adapter.createProcessingRequest(
      'user-2',
      'source-2',
      'idem-2',
    );

    expect(first).toMatchObject({
      processingRequestId: 'pr-user-1-source-1-1',
    });
    expect(second).toMatchObject({
      processingRequestId: 'pr-user-2-source-2-2',
    });
  });

  it('rejects with CatalogUnavailableError when configured to reject', async () => {
    adapter.setNextRequestShouldReject(true);

    await expect(
      adapter.createProcessingRequest('user-123', 'videos/clip.mp4', 'idem-1'),
    ).rejects.toThrow(CatalogUnavailableError);
  });

  describe('owner-scoped reads', () => {
    it("never shows one owner the other owner's requests", async () => {
      const alices = await createdId('alice', 'a.mp4');
      const bobs = await createdId('bob', 'b.mp4');

      const alicePage = await adapter.listOwned('alice', 1, 20);
      const bobPage = await adapter.listOwned('bob', 1, 20);

      expect(alicePage.items.map((i) => i.processingRequestId)).toEqual([
        alices,
      ]);
      expect(alicePage.total).toBe(1);
      expect(bobPage.items.map((i) => i.processingRequestId)).toEqual([bobs]);
      await expect(adapter.getOwned('bob', alices)).resolves.toBeUndefined();
      await expect(adapter.getOwned('alice', bobs)).resolves.toBeUndefined();
    });

    it('lists newest first and pages with the true total', async () => {
      const ids: string[] = [];
      for (const key of ['1.mp4', '2.mp4', '3.mp4']) {
        ids.push(await createdId('alice', key));
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
      const created = await createdId('alice', 'a.mp4');

      const found = await adapter.getOwned('alice', created);

      expect(found).toMatchObject({
        processingRequestId: created,
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

  describe('idempotent create', () => {
    it('replays the same request for the same owner, key and source, storing one', async () => {
      const first = await adapter.createProcessingRequest(
        'alice',
        'sources/alice/a.mp4',
        'idem-1',
      );
      const again = await adapter.createProcessingRequest(
        'alice',
        'sources/alice/a.mp4',
        'idem-1',
      );

      expect(first).toMatchObject({ outcome: 'created', status: 'RECEIVED' });
      expect(again).toMatchObject({
        outcome: 'replayed',
        status: 'RECEIVED',
        processingRequestId: (first as { processingRequestId: string })
          .processingRequestId,
      });
      expect((await adapter.listOwned('alice', 1, 20)).total).toBe(1);
    });

    it('answers conflict for the same owner and key with another source, storing nothing', async () => {
      await adapter.createProcessingRequest(
        'alice',
        'sources/alice/a.mp4',
        'idem-1',
      );

      const other = await adapter.createProcessingRequest(
        'alice',
        'sources/alice/b.mp4',
        'idem-1',
      );

      expect(other).toStrictEqual({ outcome: 'conflict' });
      expect((await adapter.listOwned('alice', 1, 20)).total).toBe(1);
    });

    it("replays the owner's request for a known source under a new key, storing nothing and leaving the new key unbound (HARD-02)", async () => {
      const first = await adapter.createProcessingRequest(
        'alice',
        'sources/alice/a.mp4',
        'idem-1',
      );

      const second = await adapter.createProcessingRequest(
        'alice',
        'sources/alice/a.mp4',
        'idem-2',
      );

      expect(first).toMatchObject({ outcome: 'created' });
      expect(second).toStrictEqual({ ...first, outcome: 'replayed' });
      expect((await adapter.listOwned('alice', 1, 20)).total).toBe(1);
      // The second key was not bound: it still creates for another source.
      await expect(
        adapter.createProcessingRequest(
          'alice',
          'sources/alice/b.mp4',
          'idem-2',
        ),
      ).resolves.toMatchObject({ outcome: 'created' });
      expect((await adapter.listOwned('alice', 1, 20)).total).toBe(2);
    });

    it('checks the key first: a key bound to another source is a conflict even when the new source already has a request', async () => {
      await adapter.createProcessingRequest(
        'alice',
        'sources/alice/a.mp4',
        'idem-1',
      );
      await adapter.createProcessingRequest(
        'alice',
        'sources/alice/b.mp4',
        'idem-2',
      );

      const res = await adapter.createProcessingRequest(
        'alice',
        'sources/alice/b.mp4',
        'idem-1',
      );

      expect(res).toStrictEqual({ outcome: 'conflict' });
      expect((await adapter.listOwned('alice', 1, 20)).total).toBe(2);
    });

    it("does not replay another owner's request for the same source", async () => {
      await adapter.createProcessingRequest('alice', 'shared.mp4', 'idem-1');

      const bobs = await adapter.createProcessingRequest(
        'bob',
        'shared.mp4',
        'idem-2',
      );

      expect(bobs).toMatchObject({ outcome: 'created' });
      expect((await adapter.listOwned('bob', 1, 20)).total).toBe(1);
    });

    it('scopes the key per owner: the same key from two owners creates two requests', async () => {
      const alices = await adapter.createProcessingRequest(
        'alice',
        'sources/alice/a.mp4',
        'shared',
      );
      const bobs = await adapter.createProcessingRequest(
        'bob',
        'sources/bob/b.mp4',
        'shared',
      );

      expect(alices).toMatchObject({ outcome: 'created' });
      expect(bobs).toMatchObject({ outcome: 'created' });
    });
  });

  describe('getArchive', () => {
    it('returns the archive key of a COMPLETED request to its owner', async () => {
      const id = await createdId('alice', 'a.mp4');
      adapter.setStatus(id, 'COMPLETED', 'zips/alice/a.zip');

      await expect(adapter.getArchive('alice', id)).resolves.toStrictEqual({
        zipStorageKey: 'zips/alice/a.zip',
      });
    });

    it.each(['RECEIVED', 'QUEUED', 'PROCESSING', 'FAILED'])(
      "answers 'not-completed' for %s",
      async (status) => {
        const id = await createdId('alice', 'a.mp4');
        if (status !== 'RECEIVED') {
          adapter.setStatus(id, status);
        }

        await expect(adapter.getArchive('alice', id)).resolves.toBe(
          'not-completed',
        );
      },
    );

    it("answers undefined for another owner's request and an unknown id", async () => {
      const id = await createdId('alice', 'a.mp4');
      adapter.setStatus(id, 'COMPLETED', 'zips/alice/a.zip');

      await expect(adapter.getArchive('bob', id)).resolves.toBeUndefined();
      await expect(
        adapter.getArchive('alice', 'unknown'),
      ).resolves.toBeUndefined();
    });

    it('rejects with CatalogUnavailableError when configured to reject', async () => {
      adapter.setNextRequestShouldReject(true);

      await expect(adapter.getArchive('alice', 'any')).rejects.toThrow(
        CatalogUnavailableError,
      );
    });
  });
});
