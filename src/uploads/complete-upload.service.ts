import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UPLOAD_STORAGE } from '../storage/upload-storage.port';
import type { UploadStorage } from '../storage/upload-storage.port';
import { CATALOG_CLIENT } from '../processing-requests/ports/catalog-client.port';
import type {
  CatalogClient,
  CatalogCreateOutcome,
} from '../processing-requests/ports/catalog-client.port';
import { CatalogUnavailableError } from '../processing-requests/errors/catalog-unavailable.error';
import { PART_SIZE_BYTES } from './start-upload.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PRINTABLE_ASCII = /^[\x20-\x7E]{1,255}$/;

export interface ConfirmedUpload {
  outcome: 'created' | 'replayed';
  processingRequestId: string;
  status: string;
}

/**
 * One body for an unknown id, another owner's id and an upload the bucket
 * already discarded, so the answer never reveals which uploads exist.
 */
const uploadNotFound = () => new NotFoundException('Upload not found');

/**
 * Confirms an upload and creates its Processing Request, exactly once per
 * `(owner, Idempotency-Key)`. Every step is idempotent or detects that a
 * concurrent confirmation already did it, so a retry after any failure is
 * safe; the Catalog's unique key makes the creation itself idempotent.
 */
@Injectable()
export class CompleteUploadService {
  private readonly logger = new Logger(CompleteUploadService.name);

  constructor(
    @Inject(UPLOAD_STORAGE) private readonly storage: UploadStorage,
    @Inject(CATALOG_CLIENT) private readonly catalog: CatalogClient,
  ) {}

  async execute(
    owner: string,
    uploadId: string,
    idempotencyKey: string | undefined,
  ): Promise<ConfirmedUpload> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (!PRINTABLE_ASCII.test(idempotencyKey)) {
      throw new BadRequestException(
        'Idempotency-Key must be 1 to 255 printable ASCII characters',
      );
    }
    if (!UUID.test(uploadId)) {
      throw uploadNotFound();
    }
    // Only the caller's own prefix is searched: another owner's id finds
    // nothing.
    const prefix = `sources/${owner}/${uploadId}.`;

    const inProgress = await this.storage.findInProgress(prefix);
    if (inProgress) {
      const parts = await this.storage.listParts(
        inProgress.key,
        inProgress.storageUploadId,
      );
      // 'gone': a concurrent confirmation completed it; carry on.
      if (parts !== 'gone') {
        if (parts.length === 0) {
          throw new BadRequestException('No part has been uploaded');
        }
        const completed = await this.storage.complete(
          inProgress.key,
          inProgress.storageUploadId,
          parts,
        );
        if (completed === 'rejected') {
          await this.discard(inProgress.key, inProgress.storageUploadId);
          throw new BadRequestException(
            `Uploaded parts are invalid: every part except the last must be ${PART_SIZE_BYTES} bytes`,
          );
        }
      }
    }

    const object = await this.storage.findObject(prefix);
    if (!object) {
      throw uploadNotFound();
    }
    if (object.sizeBytes !== object.declaredSizeBytes) {
      await this.storage.deleteObject(object.key);
      throw new BadRequestException(
        `sizeBytes was declared as ${object.declaredSizeBytes} but the upload has ${object.sizeBytes} bytes`,
      );
    }

    const created = await this.create(owner, object.key, idempotencyKey);
    if (created.outcome === 'conflict') {
      throw new ConflictException(
        'Idempotency-Key is already used for another upload',
      );
    }
    return {
      outcome: created.outcome,
      processingRequestId: created.processingRequestId,
      status: created.status,
    };
  }

  /**
   * Best effort: if the abort fails, the bucket's 1-day rule discards the
   * upload. Only the error's name is logged; the rest may carry the key.
   */
  private async discard(key: string, storageUploadId: string): Promise<void> {
    try {
      await this.storage.abortMultipart(key, storageUploadId);
    } catch (error) {
      const name = (error as { name?: string })?.name ?? 'unknown';
      this.logger.warn(`Aborting an upload with invalid parts failed: ${name}`);
    }
  }

  private async create(
    owner: string,
    key: string,
    idempotencyKey: string,
  ): Promise<CatalogCreateOutcome> {
    try {
      return await this.catalog.createProcessingRequest(
        owner,
        key,
        idempotencyKey,
      );
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw new HttpException('Catalog unavailable', HttpStatus.BAD_GATEWAY);
      }
      throw error;
    }
  }
}
