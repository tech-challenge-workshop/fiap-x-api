import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './../src/app.module';
import { S3UploadStorage } from './../src/storage/s3-upload-storage';
import { UPLOAD_STORAGE } from './../src/storage/upload-storage.port';
import { TestIdentityProvider } from './support/test-identity-provider';
import { TestStorageEnv } from './support/test-storage';

describe('Storage composition (e2e)', () => {
  const idp = new TestIdentityProvider();
  const storageEnv = new TestStorageEnv();

  beforeEach(async () => {
    await idp.start();
    storageEnv.set();
  });

  afterEach(async () => {
    storageEnv.restore();
    await idp.stop();
  });

  it.each([
    'STORAGE_ENDPOINT',
    'STORAGE_PUBLIC_ENDPOINT',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY',
    'STORAGE_SECRET_KEY',
  ])('refuses to boot when %s is missing', async (name) => {
    delete process.env[name];

    await expect(
      NestFactory.create(AppModule, { abortOnError: false, logger: false }),
    ).rejects.toThrow(new Error(`${name} is required`));
  });

  it('binds UPLOAD_STORAGE to the S3 adapter when storage is configured', async () => {
    const app: INestApplication = await NestFactory.create(AppModule, {
      abortOnError: false,
      logger: false,
    });
    try {
      await app.init();

      expect(app.get(UPLOAD_STORAGE)).toBeInstanceOf(S3UploadStorage);
    } finally {
      await app.close();
    }
  });
});
