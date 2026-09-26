import {
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { S3Sender, S3UploadStorage } from './s3-upload-storage';
import { StorageUnavailableError } from './storage-unavailable.error';

/**
 * `findObject` lists the prefix, then heads the key it found. An object
 * deleted between the two calls is absent, not a storage failure (HARD-08).
 * A fake sender stands in for storage, answering each command in turn.
 */
describe('S3UploadStorage.findObject', () => {
  const PREFIX = 'sources/alice/11111111-1111-4111-8111-111111111111.';
  const KEY = `${PREFIX}mp4`;
  const presigner = new S3Client({ region: 'us-east-1' });

  afterAll(() => presigner.destroy());

  /** Lists `KEY` under the prefix, then answers the head with `head`. */
  const storageWhoseHead = (head: () => unknown) => {
    const sender: S3Sender = {
      send: jest.fn((command: unknown) => {
        if (command instanceof ListObjectsV2Command) {
          return Promise.resolve({ Contents: [{ Key: KEY }] });
        }
        if (command instanceof HeadObjectCommand) {
          return Promise.resolve().then(head);
        }
        return Promise.reject(new Error('unexpected command'));
      }),
    };
    return new S3UploadStorage(sender, presigner, 'fiapx');
  };

  it('finds the listed object when the head succeeds', async () => {
    const storage = storageWhoseHead(() => ({
      ContentLength: 20,
      Metadata: { 'declared-size': '20' },
    }));

    await expect(storage.findObject(PREFIX)).resolves.toEqual({
      key: KEY,
      sizeBytes: 20,
      declaredSizeBytes: 20,
    });
  });

  it('finds nothing when the object is deleted between the listing and the head (NotFound)', async () => {
    const storage = storageWhoseHead(() => {
      throw new NotFound({
        message: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });
    });

    await expect(storage.findObject(PREFIX)).resolves.toBeUndefined();
  });

  it('throws StorageUnavailableError for any other head error', async () => {
    const storage = storageWhoseHead(() => {
      throw new S3ServiceException({
        name: 'AccessDenied',
        $fault: 'client',
        message: 'Access Denied',
        $metadata: { httpStatusCode: 403 },
      });
    });

    const failure = storage.findObject(PREFIX);

    await expect(failure).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(failure).rejects.toThrow('Storage unavailable (AccessDenied)');
  });
});
