import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { InMemoryUploadStorage } from './../../src/storage/in-memory-upload-storage';

export const PART_SIZE = 16_777_216;

export interface StartedTestUpload {
  uploadId: string;
  /** The key the API generated, read from the storage double. */
  key: string;
  storageUploadId: string;
}

/** Starts an upload through `POST /uploads` as the token's owner. */
export async function startUpload(
  app: INestApplication<App>,
  storage: InMemoryUploadStorage,
  token: string,
  sizeBytes: number,
  fileName = 'clip.mp4',
): Promise<StartedTestUpload> {
  const res = await request(app.getHttpServer())
    .post('/uploads')
    .set('Authorization', `Bearer ${token}`)
    .send({
      fileName,
      contentType: fileName.toLowerCase().endsWith('.mov')
        ? 'video/quicktime'
        : 'video/mp4',
      sizeBytes,
    })
    .expect(201);
  const { uploadId } = res.body as { uploadId: string };
  const signed = storage.presigned.find(
    (record) => record.kind === 'part' && record.key.includes(`/${uploadId}.`),
  );
  if (!signed || signed.kind !== 'part') {
    throw new Error(`No part was presigned for upload ${uploadId}`);
  }
  return { uploadId, key: signed.key, storageUploadId: signed.storageUploadId };
}

/** What the client's `PUT`s do: every part of `sizeBytes`, 16 MiB each. */
export function uploadParts(
  storage: InMemoryUploadStorage,
  upload: StartedTestUpload,
  sizeBytes: number,
): void {
  for (let offset = 0, part = 1; offset < sizeBytes; offset += PART_SIZE) {
    storage.uploadPart(
      upload.storageUploadId,
      part,
      Math.min(PART_SIZE, sizeBytes - offset),
    );
    part += 1;
  }
}

/** `POST /uploads/:uploadId/complete`; `null` sends no Idempotency-Key. */
export function confirm(
  app: INestApplication<App>,
  token: string,
  uploadId: string,
  idempotencyKey: string | null,
) {
  const req = request(app.getHttpServer())
    .post(`/uploads/${uploadId}/complete`)
    .set('Authorization', `Bearer ${token}`);
  if (idempotencyKey !== null) {
    void req.set('Idempotency-Key', idempotencyKey);
  }
  return req.send();
}

let keySequence = 0;

/**
 * Creates a Processing Request the only way the API allows: start an
 * upload, send its parts, confirm it. Returns the new id and the key.
 */
export async function createThroughUpload(
  app: INestApplication<App>,
  storage: InMemoryUploadStorage,
  token: string,
  sizeBytes = 1,
): Promise<{ processingRequestId: string; key: string }> {
  const upload = await startUpload(app, storage, token, sizeBytes);
  uploadParts(storage, upload, sizeBytes);
  keySequence += 1;
  const res = await confirm(
    app,
    token,
    upload.uploadId,
    `test-key-${keySequence}`,
  ).expect(201);
  return {
    processingRequestId: (res.body as { processingRequestId: string })
      .processingRequestId,
    key: upload.key,
  };
}
