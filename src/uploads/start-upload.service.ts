import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STORAGE_CONFIG } from '../storage/storage.module';
import type { StorageConfig } from '../storage/storage.config';
import { UPLOAD_STORAGE } from '../storage/upload-storage.port';
import type { UploadStorage } from '../storage/upload-storage.port';
import { StartUploadDto, videoExtensionOf } from './start-upload.dto';

export const PART_SIZE_BYTES = 16 * 1024 * 1024;

export interface StartedUpload {
  uploadId: string;
  partSize: number;
  parts: { partNumber: number; url: string }[];
  expiresAt: string;
}

/**
 * Starts a multipart upload under a key the API generates in the caller's
 * prefix. The session id is the client's `uploadId`; the key itself is never
 * returned. Never log a part URL: it grants access to its object.
 */
@Injectable()
export class StartUploadService {
  constructor(
    @Inject(UPLOAD_STORAGE) private readonly storage: UploadStorage,
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
  ) {}

  async execute(owner: string, dto: StartUploadDto): Promise<StartedUpload> {
    const uploadId = randomUUID();
    const key = `sources/${owner}/${uploadId}.${videoExtensionOf(dto.fileName)}`;
    const ttlSeconds = this.config.uploadUrlTtlSeconds;
    // Taken before signing, so it never promises more than a URL lasts.
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const storageUploadId = await this.storage.startMultipart(
      key,
      dto.contentType,
      dto.sizeBytes,
    );
    const partNumbers = Array.from(
      { length: Math.ceil(dto.sizeBytes / PART_SIZE_BYTES) },
      (_, index) => index + 1,
    );
    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.storage.presignPart(
          key,
          storageUploadId,
          partNumber,
          ttlSeconds,
        ),
      })),
    );

    return { uploadId, partSize: PART_SIZE_BYTES, parts, expiresAt };
  }
}
