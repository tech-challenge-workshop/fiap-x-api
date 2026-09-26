import {
  InProgressUpload,
  StoredObject,
  UploadedPart,
  UploadStorage,
} from './upload-storage.port';

interface Upload {
  key: string;
  declaredSize: number;
  parts: Map<number, { etag: string; size: number }>;
}

export type PresignRecord =
  | {
      kind: 'part';
      key: string;
      storageUploadId: string;
      partNumber: number;
      ttlSeconds: number;
      url: string;
    }
  | {
      kind: 'get';
      key: string;
      ttlSeconds: number;
      downloadName: string;
      url: string;
    };

const FAKE_ORIGIN = 'http://storage.test';
/** S3's minimum size for every part except the last. */
const MIN_PART_SIZE = 5 * 1024 * 1024;
const BUCKET = 'fiapx';

/**
 * Test double for `UploadStorage`, answering as RustFS did in the design's
 * spike. `uploadPart` and `discardUpload` stand in for the client's `PUT`
 * and for the bucket's lifecycle rule. Presigned URLs are fakes shaped like
 * real ones, `X-Amz-Signature` included, and every presign is recorded in
 * `presigned`.
 */
export class InMemoryUploadStorage implements UploadStorage {
  readonly presigned: PresignRecord[] = [];
  private readonly uploads = new Map<string, Upload>();
  private readonly objects = new Map<string, StoredObject>();
  private sequence = 0;

  startMultipart(
    key: string,
    _contentType: string,
    declaredSize: number,
  ): Promise<string> {
    const storageUploadId = `upload-${this.next()}`;
    this.uploads.set(storageUploadId, { key, declaredSize, parts: new Map() });
    return Promise.resolve(storageUploadId);
  }

  presignPart(
    key: string,
    storageUploadId: string,
    partNumber: number,
    ttlSeconds: number,
  ): Promise<string> {
    const url = this.sign(key, ttlSeconds, {
      partNumber: String(partNumber),
      uploadId: storageUploadId,
    });
    this.presigned.push({
      kind: 'part',
      key,
      storageUploadId,
      partNumber,
      ttlSeconds,
      url,
    });
    return Promise.resolve(url);
  }

  /** What the client's `PUT` to a part URL does; returns the part's ETag. */
  uploadPart(
    storageUploadId: string,
    partNumber: number,
    size: number,
  ): string {
    const upload = this.uploads.get(storageUploadId);
    if (!upload) {
      throw new Error(`NoSuchUpload: ${storageUploadId}`);
    }
    const etag = `"etag-${this.next()}"`;
    upload.parts.set(partNumber, { etag, size });
    return etag;
  }

  /** What the bucket's lifecycle rule does to an abandoned upload. */
  discardUpload(storageUploadId: string): void {
    this.uploads.delete(storageUploadId);
  }

  findInProgress(prefix: string): Promise<InProgressUpload | undefined> {
    for (const [storageUploadId, upload] of this.uploads) {
      if (upload.key.startsWith(prefix)) {
        return Promise.resolve({ key: upload.key, storageUploadId });
      }
    }
    return Promise.resolve(undefined);
  }

  listParts(
    _key: string,
    storageUploadId: string,
  ): Promise<UploadedPart[] | 'gone'> {
    const upload = this.uploads.get(storageUploadId);
    if (!upload) {
      return Promise.resolve('gone');
    }
    const parts = [...upload.parts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([partNumber, { etag, size }]) => ({ partNumber, etag, size }));
    return Promise.resolve(parts);
  }

  complete(
    key: string,
    storageUploadId: string,
    parts: UploadedPart[],
  ): Promise<'completed' | 'gone' | 'rejected'> {
    const upload = this.uploads.get(storageUploadId);
    if (!upload) {
      return Promise.resolve('gone');
    }
    // As S3 answers InvalidPart, InvalidPartOrder and EntityTooSmall; the
    // upload stays in progress until it is aborted.
    const rejected = parts.some((part, index) => {
      const stored = upload.parts.get(part.partNumber);
      const isLast = index === parts.length - 1;
      return (
        !stored ||
        stored.etag !== part.etag ||
        (index > 0 && part.partNumber <= parts[index - 1].partNumber) ||
        (!isLast && stored.size < MIN_PART_SIZE)
      );
    });
    if (rejected) {
      return Promise.resolve('rejected');
    }
    const sizeBytes = parts.reduce(
      (sum, part) => sum + (upload.parts.get(part.partNumber)?.size ?? 0),
      0,
    );
    this.uploads.delete(storageUploadId);
    this.objects.set(key, {
      key,
      sizeBytes,
      declaredSizeBytes: upload.declaredSize,
    });
    return Promise.resolve('completed');
  }

  abortMultipart(_key: string, storageUploadId: string): Promise<void> {
    this.uploads.delete(storageUploadId);
    return Promise.resolve();
  }

  findObject(prefix: string): Promise<StoredObject | undefined> {
    for (const object of this.objects.values()) {
      if (object.key.startsWith(prefix)) {
        return Promise.resolve({ ...object });
      }
    }
    return Promise.resolve(undefined);
  }

  deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  presignGet(
    key: string,
    ttlSeconds: number,
    downloadName: string,
  ): Promise<string> {
    const url = this.sign(key, ttlSeconds, {
      'response-content-disposition': `attachment; filename="${downloadName}"`,
    });
    this.presigned.push({ kind: 'get', key, ttlSeconds, downloadName, url });
    return Promise.resolve(url);
  }

  private sign(
    key: string,
    ttlSeconds: number,
    params: Record<string, string>,
  ): string {
    const url = new URL(`${FAKE_ORIGIN}/${BUCKET}/${key}`);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }
    url.searchParams.set('X-Amz-Expires', String(ttlSeconds));
    url.searchParams.set('X-Amz-Signature', `fake-signature-${this.next()}`);
    return url.toString();
  }

  private next(): number {
    this.sequence += 1;
    return this.sequence;
  }
}
