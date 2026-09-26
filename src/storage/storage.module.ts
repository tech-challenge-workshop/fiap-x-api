import { Module } from '@nestjs/common';
import { loadStorageConfig, StorageConfig } from './storage.config';
import { S3UploadStorage } from './s3-upload-storage';
import { UPLOAD_STORAGE } from './upload-storage.port';

export const STORAGE_CONFIG = Symbol('STORAGE_CONFIG');

/**
 * Binds the upload storage port to S3. Fails closed: without its
 * configuration the app refuses to boot, and there is no in-memory
 * fallback. Tests replace `UPLOAD_STORAGE` explicitly.
 */
@Module({
  providers: [
    {
      provide: STORAGE_CONFIG,
      useFactory: (): StorageConfig => loadStorageConfig(process.env),
    },
    {
      provide: UPLOAD_STORAGE,
      inject: [STORAGE_CONFIG],
      useFactory: (config: StorageConfig) => S3UploadStorage.fromConfig(config),
    },
  ],
  exports: [STORAGE_CONFIG, UPLOAD_STORAGE],
})
export class StorageModule {}
