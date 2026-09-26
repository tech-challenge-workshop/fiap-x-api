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
import { createThroughUpload } from './support/upload-flow';

interface DownloadBody {
  url: string;
  expiresAt: string;
}

describe('GET /processing-requests/:id/download (e2e)', () => {
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
    jest.useRealTimers();
    await app.close();
  });

  /** Alice's request, moved to `status` as the Worker would; `COMPLETED` gets a ZIP. */
  const aliceRequest = async (status = 'COMPLETED') => {
    const { processingRequestId: id } = await createThroughUpload(
      app,
      storage,
      alice,
    );
    const zipKey = `zips/alice/${id}.zip`;
    if (status !== 'RECEIVED') {
      catalog.setStatus(
        id,
        status,
        status === 'COMPLETED' ? zipKey : undefined,
      );
    }
    return { id, zipKey };
  };

  const download = (token: string, id: string) =>
    request(app.getHttpServer())
      .get(`/processing-requests/${encodeURIComponent(id)}/download`)
      .set('Authorization', `Bearer ${token}`);

  const signedGets = () =>
    storage.presigned.filter((record) => record.kind === 'get');

  /** Freezes only the wall clock, at the real current time, so tokens stay valid. */
  const freezeClock = (): number => {
    const now = Date.now();
    jest.useFakeTimers({
      now,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    return now;
  };

  it('answers the owner of a COMPLETED request 200 {url, expiresAt}: a presigned GET of its archive, named frames-<id>.zip, for five minutes (AC P3.1, P3.5)', async () => {
    const { id, zipKey } = await aliceRequest();
    const now = freezeClock();

    const res = await download(alice, id).expect(200);

    const body = res.body as DownloadBody;
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'url']);
    expect(body.expiresAt).toBe(new Date(now + 300 * 1000).toISOString());
    expect(signedGets()).toEqual([
      {
        kind: 'get',
        key: zipKey,
        ttlSeconds: 300,
        downloadName: `frames-${id}.zip`,
        url: body.url,
      },
    ]);
    expect(res.text).not.toContain('zipStorageKey');
    expect(Object.values(body)).not.toContain(zipKey);
  });

  it('issues a new URL on every call (AC P3.2)', async () => {
    const { id } = await aliceRequest();

    const first = await download(alice, id).expect(200);
    const second = await download(alice, id).expect(200);

    expect((second.body as DownloadBody).url).not.toBe(
      (first.body as DownloadBody).url,
    );
    expect(signedGets()).toHaveLength(2);
  });

  it.each(['RECEIVED', 'QUEUED', 'PROCESSING', 'FAILED'])(
    'answers 409 for a %s request and issues no URL (AC P3.3)',
    async (status) => {
      const { id } = await aliceRequest(status);

      const res = await download(alice, id).expect(409);

      expect(res.body).toEqual({
        statusCode: 409,
        message: 'Processing request is not completed',
      });
      expect(signedGets()).toHaveLength(0);
    },
  );

  it("answers another owner's id, a random UUID and a malformed id with the S5 reads' byte-identical 404, issuing no URL (AC P3.4)", async () => {
    const { id } = await aliceRequest();
    const archiveSpy = jest.spyOn(catalog, 'getArchive');

    const responses: Response[] = [
      await download(bob, id).expect(404),
      await download(bob, '3f2b8c1e-9d4a-4e6b-8f1a-2c3d4e5f6a7b').expect(404),
      await download(bob, 'not-a-uuid').expect(404),
    ];
    const s5Read = await request(app.getHttpServer())
      .get(`/processing-requests/${encodeURIComponent(id)}`)
      .set('Authorization', `Bearer ${bob}`)
      .expect(404);

    expect(responses[0].body).toEqual({
      statusCode: 404,
      message: 'Processing request not found',
    });
    for (const res of responses) {
      expect(res.text).toBe(s5Read.text);
      expect(res.headers['content-type']).toBe(s5Read.headers['content-type']);
    }
    expect(archiveSpy).toHaveBeenNthCalledWith(1, 'bob', id);
    expect(signedGets()).toHaveLength(0);
  });

  it('answers 502 when the Catalog is down (AC P3.6)', async () => {
    const { id } = await aliceRequest();
    catalog.setNextRequestShouldReject(true);

    const res = await download(alice, id).expect(502);

    expect(res.body).toEqual({
      statusCode: 502,
      message: 'Catalog unavailable',
    });
    expect(signedGets()).toHaveLength(0);
  });

  it('answers 502 when storage cannot presign (AC P3.6)', async () => {
    const { id } = await aliceRequest();
    jest
      .spyOn(storage, 'presignGet')
      .mockRejectedValue(new StorageUnavailableError());

    const res = await download(alice, id).expect(502);

    expect(res.body).toEqual({
      statusCode: 502,
      message: 'Storage unavailable',
    });
  });

  it('answers 401 without a token and touches neither the Catalog nor storage', async () => {
    const { id } = await aliceRequest();
    const catalogCalls = countCatalogCalls(catalog);
    const storageCalls = countCatalogCalls(storage);

    const res = await request(app.getHttpServer())
      .get(`/processing-requests/${encodeURIComponent(id)}/download`)
      .expect(401);

    expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    expect(catalogCalls()).toBe(0);
    expect(storageCalls()).toBe(0);
  });

  it('never logs the download URL, its signature or the archive key, on success or on failure (edge case, UPL-10)', async () => {
    const { id, zipKey } = await aliceRequest();
    const ok = await download(alice, id).expect(200);
    jest
      .spyOn(storage, 'presignGet')
      .mockRejectedValue(new StorageUnavailableError());
    await download(alice, id).expect(502);
    catalog.setNextRequestShouldReject(true);
    await download(alice, id).expect(502);

    const logs = logger.text;
    expect(logs).toContain(
      'Mapped {/processing-requests/:id/download, GET} route',
    );
    expect(logs).not.toContain((ok.body as DownloadBody).url);
    expect(logs).not.toContain('X-Amz-Signature');
    expect(logs).not.toContain('fake-signature');
    expect(logs).not.toContain(zipKey);
  });
});
