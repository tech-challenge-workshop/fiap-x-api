export const UPLOAD_STORAGE = Symbol('UPLOAD_STORAGE');

export interface UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface InProgressUpload {
  key: string;
  storageUploadId: string;
}

export interface StoredObject {
  key: string;
  sizeBytes: number;
  /** The size the client declared when the upload started. */
  declaredSizeBytes: number;
}

/**
 * Where an upload lives between start and confirmation. The state is the
 * storage itself: the key's prefix names the owner and the session, and the
 * declared size rides on the object as metadata. Absence is a return value;
 * any failure to reach storage is a `StorageUnavailableError`.
 */
export interface UploadStorage {
  /** Starts a multipart upload and returns the storage's `UploadId`. */
  startMultipart(
    key: string,
    contentType: string,
    declaredSize: number,
  ): Promise<string>;

  presignPart(
    key: string,
    storageUploadId: string,
    partNumber: number,
    ttlSeconds: number,
  ): Promise<string>;

  /** The multipart upload in progress under `prefix`, if any. */
  findInProgress(prefix: string): Promise<InProgressUpload | undefined>;

  /** Parts in part-number order; `'gone'` once the upload no longer exists. */
  listParts(
    key: string,
    storageUploadId: string,
  ): Promise<UploadedPart[] | 'gone'>;

  /**
   * `'gone'` when the upload no longer exists, e.g. already completed.
   * `'rejected'` when storage refuses the parts themselves (a non-final part
   * under the minimum size, a wrong ETag, parts out of order); the upload
   * then stays in progress until it is aborted.
   */
  complete(
    key: string,
    storageUploadId: string,
    parts: UploadedPart[],
  ): Promise<'completed' | 'gone' | 'rejected'>;

  /** Discards a multipart upload; one that no longer exists is not an error. */
  abortMultipart(key: string, storageUploadId: string): Promise<void>;

  /** The completed object under `prefix`, if any. */
  findObject(prefix: string): Promise<StoredObject | undefined>;

  deleteObject(key: string): Promise<void>;

  /** A GET URL that downloads the object as `downloadName`. */
  presignGet(
    key: string,
    ttlSeconds: number,
    downloadName: string,
  ): Promise<string>;
}
