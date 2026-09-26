import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageUnavailableError } from './storage-unavailable.error';
import {
  InProgressUpload,
  StoredObject,
  UploadedPart,
  UploadStorage,
} from './upload-storage.port';

export interface S3UploadStorageConfig {
  endpoint: string;
  publicEndpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * The SDK requires a region to sign requests. S3-compatible servers such as
 * RustFS accept any value, so it is fixed rather than configured.
 */
const SIGNING_REGION = 'us-east-1';

const DECLARED_SIZE = 'declared-size';

/** The only member of the SDK client the adapter calls storage with. */
export type S3Sender = Pick<S3Client, 'send'>;

function createClient(
  endpoint: string,
  config: S3UploadStorageConfig,
): S3Client {
  return new S3Client({
    endpoint,
    region: SIGNING_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // By default the SDK signs a CRC32 of the (empty) body into a presigned
    // UploadPart URL, and storage then refuses every real part with 400
    // BadDigest. Checksums only where the operation requires one.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/**
 * The upload storage port over the S3 API (AD-005; RustFS locally, AD-014).
 * Calls go through the internal client. Presigning goes through a client on
 * the public endpoint, because a signature binds the host the client will
 * use; presigning is offline, so that client never opens a connection.
 * Never log a presigned URL: it grants access to its object.
 */
export class S3UploadStorage implements UploadStorage {
  constructor(
    private readonly client: S3Sender,
    private readonly presigner: S3Client,
    private readonly bucket: string,
  ) {}

  static fromConfig(config: S3UploadStorageConfig): S3UploadStorage {
    return new S3UploadStorage(
      createClient(config.endpoint, config),
      createClient(config.publicEndpoint, config),
      config.bucket,
    );
  }

  async startMultipart(
    key: string,
    contentType: string,
    declaredSize: number,
  ): Promise<string> {
    const response = await this.call(() =>
      this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: contentType,
          Metadata: { [DECLARED_SIZE]: String(declaredSize) },
        }),
      ),
    );
    if (!response.UploadId) {
      throw new StorageUnavailableError('Storage returned no upload id');
    }
    return response.UploadId;
  }

  presignPart(
    key: string,
    storageUploadId: string,
    partNumber: number,
    ttlSeconds: number,
  ): Promise<string> {
    return this.call(() =>
      getSignedUrl(
        this.presigner,
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: storageUploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: ttlSeconds },
      ),
    );
  }

  async findInProgress(prefix: string): Promise<InProgressUpload | undefined> {
    const response = await this.call(() =>
      this.client.send(
        new ListMultipartUploadsCommand({
          Bucket: this.bucket,
          Prefix: prefix,
        }),
      ),
    );
    const found = response.Uploads?.find(
      (upload) => upload.Key?.startsWith(prefix) && upload.UploadId,
    );
    return found?.Key && found.UploadId
      ? { key: found.Key, storageUploadId: found.UploadId }
      : undefined;
  }

  async listParts(
    key: string,
    storageUploadId: string,
  ): Promise<UploadedPart[] | 'gone'> {
    try {
      const response = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: storageUploadId,
        }),
      );
      return (response.Parts ?? [])
        .map((part) => ({
          partNumber: part.PartNumber ?? 0,
          etag: part.ETag ?? '',
          size: part.Size ?? 0,
        }))
        .sort((a, b) => a.partNumber - b.partNumber);
    } catch (error) {
      if (isNoSuchUpload(error)) {
        return 'gone';
      }
      throw unavailable(error);
    }
  }

  async complete(
    key: string,
    storageUploadId: string,
    parts: UploadedPart[],
  ): Promise<'completed' | 'gone' | 'rejected'> {
    try {
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: storageUploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
            })),
          },
        }),
      );
      return 'completed';
    } catch (error) {
      if (isNoSuchUpload(error)) {
        return 'gone';
      }
      if (isRejectedParts(error)) {
        return 'rejected';
      }
      throw unavailable(error);
    }
  }

  async abortMultipart(key: string, storageUploadId: string): Promise<void> {
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: storageUploadId,
        }),
      );
    } catch (error) {
      if (isNoSuchUpload(error)) {
        return;
      }
      throw unavailable(error);
    }
  }

  async findObject(prefix: string): Promise<StoredObject | undefined> {
    const listed = await this.call(() =>
      this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: 1,
        }),
      ),
    );
    const key = listed.Contents?.[0]?.Key;
    if (!key) {
      return undefined;
    }
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        sizeBytes: head.ContentLength ?? 0,
        declaredSizeBytes: Number(head.Metadata?.[DECLARED_SIZE]),
      };
    } catch (error) {
      // Deleted between the listing and the head: absent, not a failure.
      if (isNotFound(error)) {
        return undefined;
      }
      throw unavailable(error);
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.call(() =>
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      ),
    );
  }

  presignGet(
    key: string,
    ttlSeconds: number,
    downloadName: string,
  ): Promise<string> {
    return this.call(() =>
      getSignedUrl(
        this.presigner,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${downloadName}"`,
        }),
        { expiresIn: ttlSeconds },
      ),
    );
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw unavailable(error);
    }
  }
}

function unavailable(error: unknown): StorageUnavailableError {
  // The SDK's error carries the request, never a presigned URL; only its
  // name is kept.
  const name = (error as { name?: string })?.name ?? 'unknown';
  return new StorageUnavailableError(`Storage unavailable (${name})`);
}

function isNoSuchUpload(error: unknown): boolean {
  const candidate = error as { name?: string; Code?: string };
  return (
    candidate?.name === 'NoSuchUpload' || candidate?.Code === 'NoSuchUpload'
  );
}

/** Storage refused the completion because of the parts the client sent. */
const REJECTED_PARTS = new Set([
  'EntityTooSmall',
  'InvalidPart',
  'InvalidPartOrder',
]);

function isRejectedParts(error: unknown): boolean {
  const candidate = error as { name?: string; Code?: string };
  return (
    REJECTED_PARTS.has(candidate?.name ?? '') ||
    REJECTED_PARTS.has(candidate?.Code ?? '')
  );
}

function isNotFound(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate?.name === 'NotFound' ||
    candidate?.name === 'NoSuchKey' ||
    candidate?.$metadata?.httpStatusCode === 404
  );
}
