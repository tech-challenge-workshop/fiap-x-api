import { loadStorageConfig } from './storage.config';

describe('loadStorageConfig', () => {
  const REQUIRED = [
    'STORAGE_ENDPOINT',
    'STORAGE_PUBLIC_ENDPOINT',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY',
    'STORAGE_SECRET_KEY',
  ];
  const complete = {
    STORAGE_ENDPOINT: 'http://storage:9000',
    STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000',
    STORAGE_BUCKET: 'fiapx',
    STORAGE_ACCESS_KEY: 'fiapx-dev',
    STORAGE_SECRET_KEY: 'fiapx-dev-secret',
  };

  it('returns both endpoints, bucket, credentials and the 3600 s / 300 s default lifetimes', () => {
    expect(loadStorageConfig({ ...complete })).toEqual({
      endpoint: 'http://storage:9000',
      publicEndpoint: 'http://localhost:9000',
      bucket: 'fiapx',
      accessKeyId: 'fiapx-dev',
      secretAccessKey: 'fiapx-dev-secret',
      uploadUrlTtlSeconds: 3600,
      downloadUrlTtlSeconds: 300,
    });
  });

  it.each(REQUIRED)('throws naming %s when it is missing', (name) => {
    const env: NodeJS.ProcessEnv = { ...complete };
    delete env[name];

    expect(() => loadStorageConfig(env)).toThrow(
      new Error(`${name} is required`),
    );
  });

  it.each(REQUIRED)('throws naming %s when it is blank', (name) => {
    const env: NodeJS.ProcessEnv = { ...complete, [name]: '   ' };

    expect(() => loadStorageConfig(env)).toThrow(
      new Error(`${name} is required`),
    );
  });

  it('reads UPLOAD_URL_TTL_SECONDS and DOWNLOAD_URL_TTL_SECONDS when set', () => {
    const config = loadStorageConfig({
      ...complete,
      UPLOAD_URL_TTL_SECONDS: '7200',
      DOWNLOAD_URL_TTL_SECONDS: '60',
    });

    expect(config.uploadUrlTtlSeconds).toBe(7200);
    expect(config.downloadUrlTtlSeconds).toBe(60);
  });

  it.each(['UPLOAD_URL_TTL_SECONDS', 'DOWNLOAD_URL_TTL_SECONDS'])(
    'falls back to the default when %s is blank',
    (name) => {
      const config = loadStorageConfig({ ...complete, [name]: '  ' });

      expect(config.uploadUrlTtlSeconds).toBe(3600);
      expect(config.downloadUrlTtlSeconds).toBe(300);
    },
  );

  describe.each(['UPLOAD_URL_TTL_SECONDS', 'DOWNLOAD_URL_TTL_SECONDS'])(
    '%s',
    (name) => {
      it.each(['0', '-1', 'abc', '1.5'])(
        'throws naming it when it is %p',
        (value) => {
          expect(() =>
            loadStorageConfig({ ...complete, [name]: value }),
          ).toThrow(new Error(`${name} must be a positive integer`));
        },
      );
    },
  );
});
