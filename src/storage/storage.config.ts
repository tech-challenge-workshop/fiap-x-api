export interface StorageConfig {
  /** Where the API itself reaches storage, e.g. `http://storage:9000`. */
  endpoint: string;
  /** The address clients use; presigned URLs are signed for this host. */
  publicEndpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
}

const DEFAULT_UPLOAD_URL_TTL_SECONDS = 3600;
const DEFAULT_DOWNLOAD_URL_TTL_SECONDS = 300;

/**
 * Fails closed like `loadOidcConfig`: the app refuses to start without its
 * storage rather than fall back to something that only looks like storage.
 */
export function loadStorageConfig(env: NodeJS.ProcessEnv): StorageConfig {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) {
      throw new Error(`${name} is required`);
    }
    return value;
  };

  const positiveInteger = (name: string, fallback: number): number => {
    const raw = env[name]?.trim();
    const value = raw ? Number(raw) : fallback;
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
    return value;
  };

  return {
    endpoint: required('STORAGE_ENDPOINT'),
    publicEndpoint: required('STORAGE_PUBLIC_ENDPOINT'),
    bucket: required('STORAGE_BUCKET'),
    accessKeyId: required('STORAGE_ACCESS_KEY'),
    secretAccessKey: required('STORAGE_SECRET_KEY'),
    uploadUrlTtlSeconds: positiveInteger(
      'UPLOAD_URL_TTL_SECONDS',
      DEFAULT_UPLOAD_URL_TTL_SECONDS,
    ),
    downloadUrlTtlSeconds: positiveInteger(
      'DOWNLOAD_URL_TTL_SECONDS',
      DEFAULT_DOWNLOAD_URL_TTL_SECONDS,
    ),
  };
}
