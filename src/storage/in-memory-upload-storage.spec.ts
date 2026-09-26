import { InMemoryUploadStorage } from './in-memory-upload-storage';

/**
 * The double must answer like RustFS did in the design's spike
 * (design.md, "Spike evidence"). Each describe names the row it mirrors.
 * The two rows about the SDK itself (host pinning, BadDigest) belong to the
 * S3 adapter's integration suite; the double has no host or checksum.
 */
describe('InMemoryUploadStorage', () => {
  const KEY = 'sources/alice/11111111-1111-4111-8111-111111111111.mp4';
  const PREFIX = 'sources/alice/11111111-1111-4111-8111-111111111111.';
  const MiB = 1024 * 1024;
  let storage: InMemoryUploadStorage;

  beforeEach(() => {
    storage = new InMemoryUploadStorage();
  });

  describe('presigned part URLs (spike row: presigned UploadPart PUT)', () => {
    it('signs a URL for the key, upload and part with the lifetime asked for', async () => {
      const uploadId = await storage.startMultipart(KEY, 'video/mp4', 20);

      const url = new URL(await storage.presignPart(KEY, uploadId, 2, 3600));

      expect(url.pathname).toBe(`/fiapx/${KEY}`);
      expect(url.searchParams.get('uploadId')).toBe(uploadId);
      expect(url.searchParams.get('partNumber')).toBe('2');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/\S/);
    });

    it('records every presign and signs each one differently', async () => {
      const uploadId = await storage.startMultipart(KEY, 'video/mp4', 20);

      const first = await storage.presignPart(KEY, uploadId, 1, 3600);
      const second = await storage.presignPart(KEY, uploadId, 1, 3600);

      expect(first).not.toBe(second);
      expect(storage.presigned).toEqual([
        {
          kind: 'part',
          key: KEY,
          storageUploadId: uploadId,
          partNumber: 1,
          ttlSeconds: 3600,
          url: first,
        },
        {
          kind: 'part',
          key: KEY,
          storageUploadId: uploadId,
          partNumber: 1,
          ttlSeconds: 3600,
          url: second,
        },
      ]);
    });
  });

  describe('ListMultipartUploads by prefix (spike row)', () => {
    it("finds the caller's upload under its session prefix", async () => {
      const uploadId = await storage.startMultipart(KEY, 'video/mp4', 20);

      await expect(storage.findInProgress(PREFIX)).resolves.toEqual({
        key: KEY,
        storageUploadId: uploadId,
      });
    });

    it("finds nothing under another owner's prefix", async () => {
      await storage.startMultipart(KEY, 'video/mp4', 20);

      await expect(
        storage.findInProgress(
          'sources/bob/11111111-1111-4111-8111-111111111111.',
        ),
      ).resolves.toBeUndefined();
    });

    it('finds nothing once the upload was discarded (bucket lifecycle)', async () => {
      const uploadId = await storage.startMultipart(KEY, 'video/mp4', 20);

      storage.discardUpload(uploadId);

      await expect(storage.findInProgress(PREFIX)).resolves.toBeUndefined();
    });
  });

  describe('ListParts (spike rows)', () => {
    it('lists no part for an upload with none', async () => {
      const uploadId = await storage.startMultipart(KEY, 'video/mp4', 20);

      await expect(storage.listParts(KEY, uploadId)).resolves.toEqual([]);
    });

    it('lists each uploaded part in order with its ETag and size', async () => {
      const uploadId = await storage.startMultipart(KEY, 'video/mp4', 20 * MiB);
      const etag2 = storage.uploadPart(uploadId, 2, 4 * MiB);
      const etag1 = storage.uploadPart(uploadId, 1, 16 * MiB);

      await expect(storage.listParts(KEY, uploadId)).resolves.toEqual([
        { partNumber: 1, etag: etag1, size: 16 * MiB },
        { partNumber: 2, etag: etag2, size: 4 * MiB },
      ]);
    });

    it("answers 'gone' for an upload that no longer exists", async () => {
      const uploadId = await storage.startMultipart(KEY, 'video/mp4', 1);
      storage.uploadPart(uploadId, 1, 1);
      await storage.complete(KEY, uploadId, await parts(uploadId));

      await expect(storage.listParts(KEY, uploadId)).resolves.toBe('gone');
    });
  });

  describe('CompleteMultipartUpload (spike rows)', () => {
    it("completes, and the object's real size and declared-size metadata read back (HeadObject row)", async () => {
      const uploadId = await storage.startMultipart(KEY, 'video/mp4', 20 * MiB);
      storage.uploadPart(uploadId, 1, 16 * MiB);
      storage.uploadPart(uploadId, 2, 3 * MiB);

      await expect(
        storage.complete(KEY, uploadId, await parts(uploadId)),
      ).resolves.toBe('completed');

      await expect(storage.findObject(PREFIX)).resolves.toEqual({
        key: KEY,
        sizeBytes: 19 * MiB,
        declaredSizeBytes: 20 * MiB,
      });
      await expect(storage.findInProgress(PREFIX)).resolves.toBeUndefined();
    });

    it("answers 'gone' when the completion is replayed (NoSuchUpload row)", async () => {
      const uploadId = await storage.startMultipart(KEY, 'video/mp4', 1);
      storage.uploadPart(uploadId, 1, 1);
      const listed = await parts(uploadId);
      await storage.complete(KEY, uploadId, listed);

      await expect(storage.complete(KEY, uploadId, listed)).resolves.toBe(
        'gone',
      );
    });
  });

  describe('ListObjectsV2 by session prefix (spike row)', () => {
    it('finds no object before completion', async () => {
      await storage.startMultipart(KEY, 'video/mp4', 20);

      await expect(storage.findObject(PREFIX)).resolves.toBeUndefined();
    });

    it("finds no object under another owner's prefix after completion", async () => {
      const uploadId = await storage.startMultipart(KEY, 'video/mp4', 1);
      storage.uploadPart(uploadId, 1, 1);
      await storage.complete(KEY, uploadId, await parts(uploadId));

      await expect(
        storage.findObject('sources/bob/11111111-1111-4111-8111-111111111111.'),
      ).resolves.toBeUndefined();
    });
  });

  describe('DeleteObject', () => {
    it('removes the object so the prefix finds nothing', async () => {
      const uploadId = await storage.startMultipart(KEY, 'video/mp4', 1);
      storage.uploadPart(uploadId, 1, 1);
      await storage.complete(KEY, uploadId, await parts(uploadId));

      await storage.deleteObject(KEY);

      await expect(storage.findObject(PREFIX)).resolves.toBeUndefined();
    });
  });

  describe('presigned GetObject with ResponseContentDisposition (spike row)', () => {
    it('signs a GET for the key with the lifetime and an attachment file name', async () => {
      const zipKey = 'archives/pr-1/frames.zip';

      const url = new URL(
        await storage.presignGet(zipKey, 300, 'frames-pr-1.zip'),
      );

      expect(url.pathname).toBe(`/fiapx/${zipKey}`);
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(url.searchParams.get('response-content-disposition')).toBe(
        'attachment; filename="frames-pr-1.zip"',
      );
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/\S/);
      expect(storage.presigned).toEqual([
        {
          kind: 'get',
          key: zipKey,
          ttlSeconds: 300,
          downloadName: 'frames-pr-1.zip',
          url: url.toString(),
        },
      ]);
    });
  });

  async function parts(uploadId: string) {
    const listed = await storage.listParts(KEY, uploadId);
    if (listed === 'gone') {
      throw new Error('upload unexpectedly gone');
    }
    return listed;
  }
});
