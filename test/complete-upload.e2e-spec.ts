import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request, { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { CATALOG_CLIENT } from './../src/processing-requests/ports/catalog-client.port';
import { InMemoryCatalogClient } from './../src/processing-requests/adapters/in-memory-catalog-client.adapter';
import { InMemoryUploadStorage } from './../src/storage/in-memory-upload-storage';
import { UPLOAD_STORAGE } from './../src/storage/upload-storage.port';
import { StorageUnavailableError } from './../src/storage/storage-unavailable.error';
import { TestIdentityProvider } from './support/test-identity-provider';
import { TestStorageEnv } from './support/test-storage';
import { countCatalogCalls } from './support/catalog-calls';
import { CapturingLogger } from './support/capturing-logger';
import {
  confirm,
  PART_SIZE,
  startUpload,
  StartedTestUpload,
  uploadParts,
} from './support/upload-flow';

const MiB = 1024 * 1024;
const NOT_FOUND = { statusCode: 404, message: 'Upload not found' };
const INVALID_PARTS = {
  statusCode: 400,
  message:
    'Uploaded parts are invalid: every part except the last must be 16777216 bytes',
};
const KEY_REQUIRED = {
  statusCode: 400,
  message: 'Idempotency-Key header is required',
};

interface ConfirmBody {
  processingRequestId: string;
  status: string;
}

describe('POST /uploads/:uploadId/complete (e2e)', () => {
  const idp = new TestIdentityProvider();
  const storageEnv = new TestStorageEnv();
  let app: INestApplication<App>;
  let storage: InMemoryUploadStorage;
  let catalog: InMemoryCatalogClient;
  let logger: CapturingLogger;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    await idp.start();
    storageEnv.set();
    alice = await idp.token({ sub: 'alice' });
    bob = await idp.token({ sub: 'bob' });
  });

  afterAll(async () => {
    storageEnv.restore();
    await idp.stop();
  });

  beforeEach(async () => {
    storage = new InMemoryUploadStorage();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UPLOAD_STORAGE)
      .useValue(storage)
      .compile();

    app = moduleFixture.createNestApplication();
    logger = new CapturingLogger();
    app.useLogger(logger);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    catalog = moduleFixture.get<InMemoryCatalogClient>(CATALOG_CLIENT);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /** An upload of `sizeBytes` whose parts have all been sent. */
  const uploaded = async (
    sizeBytes = 20 * MiB,
    token = alice,
  ): Promise<StartedTestUpload> => {
    const upload = await startUpload(app, storage, token, sizeBytes);
    uploadParts(storage, upload, sizeBytes);
    return upload;
  };

  const requestsOf = async (owner: string) =>
    (await catalog.listOwned(owner, 1, 100)).items.map(
      (item) => item.processingRequestId,
    );

  const stillInProgress = (upload: StartedTestUpload) =>
    storage.findInProgress(`sources/alice/${upload.uploadId}.`);

  it("completes the upload and creates one request for the token's sub with the generated key and the client's key, answering 201 {processingRequestId, status} (AC P2.1, P2.2)", async () => {
    const upload = await uploaded();
    const createSpy = jest.spyOn(catalog, 'createProcessingRequest');

    const res = await confirm(app, alice, upload.uploadId, 'key-1').expect(201);

    const body = res.body as ConfirmBody;
    expect(Object.keys(body).sort()).toEqual(['processingRequestId', 'status']);
    expect(body.status).toBe('RECEIVED');
    expect(createSpy).toHaveBeenCalledWith(
      'alice',
      `sources/alice/${upload.uploadId}.mp4`,
      'key-1',
    );
    expect(await requestsOf('alice')).toEqual([body.processingRequestId]);
    await expect(stillInProgress(upload)).resolves.toBeUndefined();
    await expect(
      storage.findObject(`sources/alice/${upload.uploadId}.`),
    ).resolves.toMatchObject({ key: upload.key, sizeBytes: 20 * MiB });
  });

  it('answers a repeated confirmation with 200 and the same id, creating nothing new (AC P2.3)', async () => {
    const upload = await uploaded();
    const first = await confirm(app, alice, upload.uploadId, 'key-1').expect(
      201,
    );

    const again = await confirm(app, alice, upload.uploadId, 'key-1').expect(
      200,
    );

    expect(again.body).toEqual(first.body);
    expect(await requestsOf('alice')).toEqual([
      (first.body as ConfirmBody).processingRequestId,
    ]);
  });

  it('answers 409 for a key already bound to another upload, creating nothing (AC P2.4)', async () => {
    const first = await uploaded();
    const second = await uploaded();
    const created = await confirm(app, alice, first.uploadId, 'key-1').expect(
      201,
    );

    const res = await confirm(app, alice, second.uploadId, 'key-1').expect(409);

    expect(res.body).toEqual({
      statusCode: 409,
      message: 'Idempotency-Key is already used for another upload',
    });
    expect(await requestsOf('alice')).toEqual([
      (created.body as ConfirmBody).processingRequestId,
    ]);
  });

  it.each<[string, string | null]>([
    ['missing', null],
    ['empty', ''],
    ['blank', '   '],
  ])(
    'answers 400 when the Idempotency-Key is %s, without touching storage or completing the upload (AC P2.5)',
    async (_, idempotencyKey) => {
      const upload = await uploaded();
      const storageCalls = countCatalogCalls(storage);
      const catalogCalls = countCatalogCalls(catalog);

      const res = await confirm(
        app,
        alice,
        upload.uploadId,
        idempotencyKey,
      ).expect(400);

      expect(res.body).toEqual(KEY_REQUIRED);
      expect(storageCalls()).toBe(0);
      expect(catalogCalls()).toBe(0);
      await expect(stillInProgress(upload)).resolves.toBeDefined();
    },
  );

  it('answers 400 for an Idempotency-Key over 255 characters, and accepts exactly 255', async () => {
    const upload = await uploaded();
    const storageCalls = countCatalogCalls(storage);

    const res = await confirm(
      app,
      alice,
      upload.uploadId,
      'k'.repeat(256),
    ).expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      message: 'Idempotency-Key must be 1 to 255 printable ASCII characters',
    });
    expect(storageCalls()).toBe(0);
    await confirm(app, alice, upload.uploadId, 'k'.repeat(255)).expect(201);
  });

  it('answers 400 when no part was uploaded, leaving the upload in progress and creating nothing (AC P2.7)', async () => {
    const upload = await startUpload(app, storage, alice, 20 * MiB);
    const catalogCalls = countCatalogCalls(catalog);

    const res = await confirm(app, alice, upload.uploadId, 'key-1').expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      message: 'No part has been uploaded',
    });
    expect(catalogCalls()).toBe(0);
    await expect(stillInProgress(upload)).resolves.toBeDefined();
  });

  it.each<[string, number, number[], string]>([
    [
      'smaller',
      20 * MiB,
      [PART_SIZE],
      'sizeBytes was declared as 20971520 but the upload has 16777216 bytes',
    ],
    [
      'larger',
      1,
      [2],
      'sizeBytes was declared as 1 but the upload has 2 bytes',
    ],
  ])(
    'answers 400 naming the size when the real size is %s than declared, deleting the object and creating nothing (AC P2.6)',
    async (_, declared, partSizes, message) => {
      const upload = await startUpload(app, storage, alice, declared);
      partSizes.forEach((size, index) =>
        storage.uploadPart(upload.storageUploadId, index + 1, size),
      );
      const catalogCalls = countCatalogCalls(catalog);

      const res = await confirm(app, alice, upload.uploadId, 'key-1').expect(
        400,
      );

      expect(res.body).toEqual({ statusCode: 400, message });
      await expect(
        storage.findObject(`sources/alice/${upload.uploadId}.`),
      ).resolves.toBeUndefined();
      expect(catalogCalls()).toBe(0);
    },
  );

  describe('parts storage refuses (HARD-01)', () => {
    /** An upload of 20 MiB whose parts are 1 byte, then 4 MiB. */
    const undersized = async () => {
      const upload = await startUpload(app, storage, alice, 20 * MiB);
      storage.uploadPart(upload.storageUploadId, 1, 1);
      storage.uploadPart(upload.storageUploadId, 2, 4 * MiB);
      return upload;
    };

    it('answers 400 naming the part size, discards the upload and creates nothing; a second confirmation is 404 (AC P1.1, P1.2, P1.3)', async () => {
      const upload = await undersized();
      const catalogCalls = countCatalogCalls(catalog);

      const res = await confirm(app, alice, upload.uploadId, 'key-1').expect(
        400,
      );

      expect(res.body).toEqual(INVALID_PARTS);
      expect(catalogCalls()).toBe(0);
      await expect(stillInProgress(upload)).resolves.toBeUndefined();
      await expect(
        storage.findObject(`sources/alice/${upload.uploadId}.`),
      ).resolves.toBeUndefined();

      const again = await confirm(app, alice, upload.uploadId, 'key-1').expect(
        404,
      );

      expect(again.body).toEqual(NOT_FOUND);
      expect(catalogCalls()).toBe(0);
      expect(await requestsOf('alice')).toEqual([]);
    });

    it('confirms parts of 5 MiB, then 1 byte, with 201 (near-miss of AC P1.1)', async () => {
      const upload = await startUpload(app, storage, alice, 5 * MiB + 1);
      storage.uploadPart(upload.storageUploadId, 1, 5 * MiB);
      storage.uploadPart(upload.storageUploadId, 2, 1);

      const res = await confirm(app, alice, upload.uploadId, 'key-1').expect(
        201,
      );

      expect(await requestsOf('alice')).toEqual([
        (res.body as ConfirmBody).processingRequestId,
      ]);
    });

    it('still answers 400 when the abort fails, logging only the error name (edge case)', async () => {
      const upload = await undersized();
      const failure = new Error(
        `abort detail ${upload.key} ${upload.storageUploadId}`,
      );
      failure.name = 'AbortFailedError';
      jest.spyOn(storage, 'abortMultipart').mockRejectedValueOnce(failure);
      const catalogCalls = countCatalogCalls(catalog);

      const res = await confirm(app, alice, upload.uploadId, 'key-1').expect(
        400,
      );

      expect(res.body).toEqual(INVALID_PARTS);
      expect(catalogCalls()).toBe(0);
      const logs = logger.text;
      expect(logs).toContain('AbortFailedError');
      expect(logs).not.toContain('abort detail');
      expect(logs).not.toContain('sources/');
      expect(logs).not.toContain(upload.storageUploadId);
      // Left to the bucket's 1-day rule.
      await expect(stillInProgress(upload)).resolves.toBeDefined();
    });
  });

  it("answers another user's uploadId, a random UUID, a malformed id and a discarded upload with byte-identical 404s (AC P2.8, edge case)", async () => {
    const alices = await uploaded();
    const discarded = await uploaded();
    storage.discardUpload(discarded.storageUploadId);
    const catalogCalls = countCatalogCalls(catalog);

    const responses: Response[] = [
      await confirm(app, bob, alices.uploadId, 'key-1').expect(404),
      await confirm(
        app,
        alice,
        '3f2b8c1e-9d4a-4e6b-8f1a-2c3d4e5f6a7b',
        'key-1',
      ).expect(404),
      await confirm(app, alice, 'not-a-uuid', 'key-1').expect(404),
      await confirm(app, alice, discarded.uploadId, 'key-1').expect(404),
    ];

    expect(responses[0].body).toEqual(NOT_FOUND);
    for (const res of responses) {
      expect(res.text).toBe(responses[0].text);
    }
    expect(catalogCalls()).toBe(0);
    // Bob's attempt left Alice's upload untouched.
    await expect(stillInProgress(alices)).resolves.toBeDefined();
  });

  it.each<[string]>([['not-a-uuid'], ['3F2B8C1E-9D4A-4E6B-8F1A-2C3D4E5F6A7']])(
    'answers a malformed uploadId (%s) with the same 404 before contacting storage (AC P2.8)',
    async (uploadId) => {
      const storageCalls = countCatalogCalls(storage);

      const res = await confirm(app, alice, uploadId, 'key-1').expect(404);

      expect(res.body).toEqual(NOT_FOUND);
      expect(storageCalls()).toBe(0);
    },
  );

  it('creates exactly one request for two concurrent confirmations that both reach completion, and both carry its id (AC P2.9)', async () => {
    const upload = await uploaded();
    const complete = storage.complete.bind(storage);
    let arrived = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => (release = resolve));
    const completeSpy = jest
      .spyOn(storage, 'complete')
      .mockImplementation(async (...args) => {
        arrived += 1;
        if (arrived === 2) {
          release();
        }
        await bothArrived;
        return complete(...args);
      });

    const [a, b] = await Promise.all([
      confirm(app, alice, upload.uploadId, 'key-1'),
      confirm(app, alice, upload.uploadId, 'key-1'),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const ids = [a, b].map(
      (res) => (res.body as ConfirmBody).processingRequestId,
    );
    expect(ids[0]).toBe(ids[1]);
    expect(await requestsOf('alice')).toEqual([ids[0]]);
    const outcomes = await Promise.all(
      completeSpy.mock.results.map((result) => result.value as Promise<string>),
    );
    expect(outcomes.sort()).toEqual(['completed', 'gone']);
  });

  it('carries the id when a concurrent confirmation completes the upload before the parts are listed (AC P2.9)', async () => {
    const upload = await uploaded();
    const listParts = storage.listParts.bind(storage);
    let concurrent: Response | undefined;
    jest
      .spyOn(storage, 'listParts')
      .mockImplementationOnce(async (key: string, storageUploadId: string) => {
        // The other confirmation runs to the end in between.
        concurrent = await confirm(app, alice, upload.uploadId, 'key-1');
        return listParts(key, storageUploadId);
      });

    const res = await confirm(app, alice, upload.uploadId, 'key-1').expect(200);

    expect(concurrent?.status).toBe(201);
    expect(res.body).toEqual(concurrent?.body);
    expect(await requestsOf('alice')).toEqual([
      (res.body as ConfirmBody).processingRequestId,
    ]);
  });

  it('answers 502 when the Catalog is down, and a retry with the same key still creates exactly one request (AC P2.10)', async () => {
    const upload = await uploaded();
    catalog.setNextRequestShouldReject(true);

    const failed = await confirm(app, alice, upload.uploadId, 'key-1').expect(
      502,
    );
    catalog.setNextRequestShouldReject(false);
    const retried = await confirm(app, alice, upload.uploadId, 'key-1').expect(
      201,
    );

    expect(failed.body).toEqual({
      statusCode: 502,
      message: 'Catalog unavailable',
    });
    expect(await requestsOf('alice')).toEqual([
      (retried.body as ConfirmBody).processingRequestId,
    ]);
  });

  it.each<['listParts' | 'complete' | 'findObject']>([
    ['listParts'],
    ['complete'],
    ['findObject'],
  ])(
    'answers 502 when storage fails in %s, and a retry with the same key still creates exactly one request (AC P2.10)',
    async (method) => {
      const upload = await uploaded();
      jest
        .spyOn(storage, method)
        .mockRejectedValueOnce(new StorageUnavailableError());
      const catalogCalls = countCatalogCalls(catalog);

      const failed = await confirm(app, alice, upload.uploadId, 'key-1').expect(
        502,
      );
      expect(catalogCalls()).toBe(0);
      const retried = await confirm(
        app,
        alice,
        upload.uploadId,
        'key-1',
      ).expect(201);

      expect(failed.body).toEqual({
        statusCode: 502,
        message: 'Storage unavailable',
      });
      expect(await requestsOf('alice')).toEqual([
        (retried.body as ConfirmBody).processingRequestId,
      ]);
    },
  );

  it('answers 401 without a token and touches neither storage nor the Catalog', async () => {
    const upload = await uploaded();
    const storageCalls = countCatalogCalls(storage);
    const catalogCalls = countCatalogCalls(catalog);

    const res = await request(app.getHttpServer())
      .post(`/uploads/${upload.uploadId}/complete`)
      .set('Idempotency-Key', 'key-1')
      .expect(401);

    expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    expect(storageCalls()).toBe(0);
    expect(catalogCalls()).toBe(0);
  });

  it('never logs a URL, a signature or the key, on success or on failure (edge case, UPL-10)', async () => {
    const ok = await uploaded();
    await confirm(app, alice, ok.uploadId, 'key-1').expect(201);
    const failing = await uploaded();
    jest
      .spyOn(storage, 'findObject')
      .mockRejectedValueOnce(new StorageUnavailableError());
    await confirm(app, alice, failing.uploadId, 'key-2').expect(502);
    catalog.setNextRequestShouldReject(true);
    await confirm(app, alice, failing.uploadId, 'key-2').expect(502);

    const logs = logger.text;
    expect(logs).toContain('Mapped {/uploads/:uploadId/complete, POST} route');
    expect(logs).not.toContain('X-Amz-Signature');
    expect(logs).not.toContain('fake-signature');
    expect(logs).not.toContain('sources/');
    for (const record of storage.presigned) {
      expect(logs).not.toContain(record.url);
    }
  });
});
