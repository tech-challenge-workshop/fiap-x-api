const STORAGE_ENV = {
  STORAGE_ENDPOINT: 'http://storage.test:9000',
  STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000',
  STORAGE_BUCKET: 'fiapx',
  STORAGE_ACCESS_KEY: 'fiapx-dev',
  STORAGE_SECRET_KEY: 'fiapx-dev-secret',
};

const STORAGE_VARIABLES = [
  ...Object.keys(STORAGE_ENV),
  'UPLOAD_URL_TTL_SECONDS',
  'DOWNLOAD_URL_TTL_SECONDS',
];

/**
 * The storage environment `AppModule` requires. Setting it builds the S3
 * adapter but opens no connection; suites that exercise routes override
 * `UPLOAD_STORAGE` with `InMemoryUploadStorage`. Call `set` before compiling
 * `AppModule` and `restore` after the suite.
 */
export class TestStorageEnv {
  private saved: Partial<Record<string, string>> = {};

  set(): void {
    for (const name of STORAGE_VARIABLES) {
      this.saved[name] = process.env[name];
      delete process.env[name];
    }
    Object.assign(process.env, STORAGE_ENV);
  }

  restore(): void {
    for (const name of STORAGE_VARIABLES) {
      const value = this.saved[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}
