import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { S3UploadStorage } from './../src/storage/s3-upload-storage';
import { StorageUnavailableError } from './../src/storage/storage-unavailable.error';
import { UploadedPart } from './../src/storage/upload-storage.port';

// Round-trips the adapter against a real S3 endpoint (RustFS, AD-014),
// repeating the design spike row by row. Skipped on a developer machine
// without STORAGE_TEST_ENDPOINT; in CI an unset endpoint fails instead, so
// the suite can never go green by skipping.
//
// The endpoint must be a loopback address (localhost or 127.0.0.1). The
// adapter signs for it as its public endpoint and makes its own calls
// through the other loopback name, so a URL that works proves the public
// client signed it.
const endpoint = process.env.STORAGE_TEST_ENDPOINT;
const credentials = {
  accessKeyId: process.env.STORAGE_TEST_ACCESS_KEY ?? 'fiapx-dev',
  secretAccessKey: process.env.STORAGE_TEST_SECRET_KEY ?? 'fiapx-dev-secret',
};
const bucket = process.env.STORAGE_TEST_BUCKET ?? 'fiapx-api-test';
const MiB = 1024 * 1024;

if (!endpoint && process.env.CI) {
  describe('S3UploadStorage against a real endpoint', () => {
    it('requires STORAGE_TEST_ENDPOINT in CI', () => {
      throw new Error('STORAGE_TEST_ENDPOINT must be set in CI');
    });
  });
}

/** The same server under the other loopback name. */
function otherLoopback(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === 'localhost') {
    parsed.hostname = '127.0.0.1';
  } else if (parsed.hostname === '127.0.0.1') {
    parsed.hostname = 'localhost';
  } else {
    throw new Error('STORAGE_TEST_ENDPOINT must use localhost or 127.0.0.1');
  }
  return parsed.origin;
}

(endpoint ? describe : describe.skip)(
  'S3UploadStorage against a real endpoint',
  () => {
    const publicEndpoint = new URL(endpoint ?? 'http://localhost').origin;
    const internalEndpoint = endpoint ? otherLoopback(endpoint) : '';
    const storage = S3UploadStorage.fromConfig({
      endpoint: internalEndpoint,
      publicEndpoint,
      bucket,
      ...credentials,
    });
    const raw = new S3Client({
      endpoint: internalEndpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials,
    });
    const created: string[] = [];

    const session = (owner = 'alice') => {
      const sessionId = randomUUID();
      const prefix = `sources/${owner}/${sessionId}.`;
      const key = `${prefix}mp4`;
      created.push(key);
      return { prefix, key };
    };

    const putPart = (url: string, bytes: number) =>
      fetch(url, { method: 'PUT', body: Buffer.alloc(bytes, 7) });

    const partsOf = async (key: string, storageUploadId: string) => {
      const parts = await storage.listParts(key, storageUploadId);
      if (parts === 'gone') {
        throw new Error('upload unexpectedly gone');
      }
      return parts;
    };

    /** Starts an upload and sends its parts through presigned URLs. */
    const upload = async (
      key: string,
      declaredSize: number,
      partSizes: number[],
    ) => {
      const storageUploadId = await storage.startMultipart(
        key,
        'video/mp4',
        declaredSize,
      );
      for (const [index, size] of partSizes.entries()) {
        const url = await storage.presignPart(
          key,
          storageUploadId,
          index + 1,
          3600,
        );
        const res = await putPart(url, size);
        expect(res.status).toBe(200);
      }
      return storageUploadId;
    };

    beforeAll(async () => {
      try {
        await raw.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (error) {
        const name = (error as { name?: string }).name;
        if (
          name !== 'BucketAlreadyOwnedByYou' &&
          name !== 'BucketAlreadyExists'
        ) {
          throw error;
        }
      }
    });

    afterAll(async () => {
      for (const key of created) {
        await raw.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      }
      raw.destroy();
    });

    it('accepts a real part PUT with plain fetch on the signed public host, and refuses the same URL on another host', async () => {
      const { key } = session();
      const storageUploadId = await storage.startMultipart(
        key,
        'video/mp4',
        5 * MiB,
      );

      const url = await storage.presignPart(key, storageUploadId, 1, 3600);

      expect(new URL(url).origin).toBe(publicEndpoint);
      expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('3600');
      const res = await putPart(url, 5 * MiB);
      expect({ status: res.status, body: await res.text() }).toEqual({
        status: 200,
        body: '',
      });
      const elsewhere = new URL(url);
      elsewhere.host = new URL(internalEndpoint).host;
      const refused = await putPart(elsewhere.toString(), 5 * MiB);
      expect(refused.status).toBe(403);
    });

    it("finds the caller's upload under its prefix, and nothing under another owner's", async () => {
      const { key, prefix } = session();
      const storageUploadId = await storage.startMultipart(
        key,
        'video/mp4',
        10,
      );

      await expect(storage.findInProgress(prefix)).resolves.toEqual({
        key,
        storageUploadId,
      });
      await expect(
        storage.findInProgress(prefix.replace('/alice/', '/bob/')),
      ).resolves.toBeUndefined();
    });

    it('lists no part for an upload with none', async () => {
      const { key } = session();
      const storageUploadId = await storage.startMultipart(
        key,
        'video/mp4',
        10,
      );

      await expect(storage.listParts(key, storageUploadId)).resolves.toEqual(
        [],
      );
    });

    it('lists the parts with ETags and sizes, completes, and reads back real size and declared-size', async () => {
      const { key, prefix } = session();
      const storageUploadId = await upload(key, 6 * MiB, [5 * MiB, 1000]);

      const parts = await partsOf(key, storageUploadId);

      expect(
        parts.map(({ partNumber, size }) => ({ partNumber, size })),
      ).toEqual([
        { partNumber: 1, size: 5 * MiB },
        { partNumber: 2, size: 1000 },
      ]);
      expect(parts.every((part) => /^"[0-9a-f]{32}"$/.test(part.etag))).toBe(
        true,
      );
      await expect(storage.findObject(prefix)).resolves.toBeUndefined();

      await expect(storage.complete(key, storageUploadId, parts)).resolves.toBe(
        'completed',
      );

      await expect(storage.findObject(prefix)).resolves.toEqual({
        key,
        sizeBytes: 5 * MiB + 1000,
        declaredSizeBytes: 6 * MiB,
      });
      await expect(storage.findInProgress(prefix)).resolves.toBeUndefined();
      const head = await raw.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      expect(head.ContentType).toBe('video/mp4');
    });

    it("answers 'gone' to a replayed completion and to listing a completed upload", async () => {
      const { key } = session();
      const storageUploadId = await upload(key, 1000, [1000]);
      const parts: UploadedPart[] = await partsOf(key, storageUploadId);
      await storage.complete(key, storageUploadId, parts);

      await expect(storage.complete(key, storageUploadId, parts)).resolves.toBe(
        'gone',
      );
      await expect(storage.listParts(key, storageUploadId)).resolves.toBe(
        'gone',
      );
    });

    it("finds no object under another owner's prefix after completion, and none once deleted", async () => {
      const { key, prefix } = session();
      const storageUploadId = await upload(key, 1000, [1000]);
      await storage.complete(
        key,
        storageUploadId,
        await partsOf(key, storageUploadId),
      );

      await expect(
        storage.findObject(prefix.replace('/alice/', '/bob/')),
      ).resolves.toBeUndefined();

      await storage.deleteObject(key);

      await expect(storage.findObject(prefix)).resolves.toBeUndefined();
    });

    it('presigns a GET on the public host that downloads the whole object as an attachment', async () => {
      const { key } = session();
      const storageUploadId = await upload(key, 1000, [1000]);
      await storage.complete(
        key,
        storageUploadId,
        await partsOf(key, storageUploadId),
      );

      const url = await storage.presignGet(key, 300, 'frames-pr-1.zip');

      expect(new URL(url).origin).toBe(publicEndpoint);
      expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('300');
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="frames-pr-1.zip"',
      );
      expect((await res.arrayBuffer()).byteLength).toBe(1000);
    });

    it('turns a denied request into StorageUnavailableError, not absence', async () => {
      const denied = S3UploadStorage.fromConfig({
        endpoint: internalEndpoint,
        publicEndpoint,
        bucket,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: 'not-the-secret',
      });

      await expect(denied.findObject('sources/alice/')).rejects.toBeInstanceOf(
        StorageUnavailableError,
      );
      await expect(
        denied.findInProgress('sources/alice/'),
      ).rejects.toBeInstanceOf(StorageUnavailableError);
    });
  },
);

describe('S3UploadStorage with storage unreachable', () => {
  const unreachable = S3UploadStorage.fromConfig({
    endpoint: 'http://127.0.0.1:1',
    publicEndpoint: 'http://127.0.0.1:1',
    bucket: 'fiapx',
    accessKeyId: 'fiapx-dev',
    secretAccessKey: 'fiapx-dev-secret',
  });
  const key = 'sources/alice/11111111-1111-4111-8111-111111111111.mp4';
  const part = { partNumber: 1, etag: '"x"', size: 1 };

  it.each([
    ['startMultipart', () => unreachable.startMultipart(key, 'video/mp4', 1)],
    ['findInProgress', () => unreachable.findInProgress('sources/alice/')],
    ['listParts', () => unreachable.listParts(key, 'upload-1')],
    ['complete', () => unreachable.complete(key, 'upload-1', [part])],
    ['findObject', () => unreachable.findObject('sources/alice/')],
    ['deleteObject', () => unreachable.deleteObject(key)],
  ])('%s rejects with StorageUnavailableError', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});
