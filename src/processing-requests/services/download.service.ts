import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CATALOG_CLIENT } from '../ports/catalog-client.port';
import type {
  CatalogArchive,
  CatalogClient,
} from '../ports/catalog-client.port';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';
import { UPLOAD_STORAGE } from '../../storage/upload-storage.port';
import type { UploadStorage } from '../../storage/upload-storage.port';
import { STORAGE_CONFIG } from '../../storage/storage.module';
import type { StorageConfig } from '../../storage/storage.config';

export interface IssuedDownload {
  url: string;
  expiresAt: string;
}

/**
 * Issues a short-lived URL for the ZIP of the owner's completed request, a
 * new one on every call. The archive key never leaves as a field, and the
 * URL is never logged: it grants access to the ZIP.
 */
@Injectable()
export class DownloadService {
  constructor(
    @Inject(CATALOG_CLIENT) private readonly catalog: CatalogClient,
    @Inject(UPLOAD_STORAGE) private readonly storage: UploadStorage,
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
  ) {}

  async execute(
    ownerUserId: string,
    processingRequestId: string,
  ): Promise<IssuedDownload> {
    let archive: CatalogArchive | undefined;
    try {
      archive = await this.catalog.getArchive(ownerUserId, processingRequestId);
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw new HttpException('Catalog unavailable', HttpStatus.BAD_GATEWAY);
      }
      throw error;
    }
    if (!archive) {
      // The same body as the S5 reads: it never reveals which requests exist.
      throw new NotFoundException('Processing request not found');
    }
    if (archive === 'not-completed') {
      throw new ConflictException('Processing request is not completed');
    }

    const ttlSeconds = this.config.downloadUrlTtlSeconds;
    // Taken before signing, so it never promises more than the URL lasts.
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const url = await this.storage.presignGet(
      archive.zipStorageKey,
      ttlSeconds,
      `frames-${processingRequestId}.zip`,
    );
    return { url, expiresAt };
  }
}
