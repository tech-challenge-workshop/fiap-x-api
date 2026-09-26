import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { CATALOG_CLIENT } from './../src/processing-requests/ports/catalog-client.port';
import { InMemoryCatalogClient } from './../src/processing-requests/adapters/in-memory-catalog-client.adapter';
import { InMemoryUploadStorage } from './../src/storage/in-memory-upload-storage';
import { UPLOAD_STORAGE } from './../src/storage/upload-storage.port';
import { TestIdentityProvider } from './support/test-identity-provider';
import { TestStorageEnv } from './support/test-storage';
import { countCatalogCalls } from './support/catalog-calls';
import { startUpload, uploadParts } from './support/upload-flow';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

/**
 * The key-supplied create path of S5 is gone: requests are created only by
 * confirming an upload, whose key the API generates (UPL-09).
 */
describe('The key-supplied create path is gone (e2e)', () => {
  const idp = new TestIdentityProvider();
  const storageEnv = new TestStorageEnv();
  let app: INestApplication<App>;
  let storage: InMemoryUploadStorage;
  let catalogClient: InMemoryCatalogClient;
  let token: string;

  beforeAll(async () => {
    await idp.start();
    storageEnv.set();
    token = await idp.token();
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    catalogClient = moduleFixture.get<InMemoryCatalogClient>(CATALOG_CLIENT);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers POST /processing-requests {sourceStorageKey} with a valid token with 404, creating nothing (AC P4.1)', async () => {
    const catalogCalls = countCatalogCalls(catalogClient);

    const res = await request(app.getHttpServer())
      .post('/processing-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceStorageKey: 'sources/bob/their-video.mp4' })
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404 });
    expect(catalogCalls()).toBe(0);
  });

  it('exposes exactly these routes, none of which takes a storage key (AC P4.1, P4.2)', () => {
    const router = (
      app.getHttpAdapter().getInstance() as {
        router: { stack: RouteLayer[] };
      }
    ).router;

    const routes = router.stack
      .filter((layer) => layer.route)
      .map(
        (layer) =>
          `${Object.keys(layer.route!.methods).join(',').toUpperCase()} ${layer.route!.path}`,
      );

    expect(routes.sort()).toEqual(
      [
        'GET /',
        'GET /health',
        'GET /processing-requests',
        'GET /processing-requests/:id',
        'GET /processing-requests/:id/download',
        'POST /uploads',
        'POST /uploads/:uploadId/complete',
      ].sort(),
    );
  });

  it('refuses a storage key in the body of POST /uploads without touching storage (AC P4.2)', async () => {
    const storageCalls = countCatalogCalls(storage);

    const res = await request(app.getHttpServer())
      .post('/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'clip.mp4',
        contentType: 'video/mp4',
        sizeBytes: 1,
        sourceStorageKey: 'sources/bob/their-video.mp4',
      })
      .expect(400);

    expect(res.body).toEqual({
      statusCode: 400,
      message: ['property sourceStorageKey should not exist'],
    });
    expect(storageCalls()).toBe(0);
  });

  it('ignores a storage key sent to the confirmation: the request gets the generated key (AC P4.2)', async () => {
    const upload = await startUpload(app, storage, token, 1);
    uploadParts(storage, upload, 1);
    const createSpy = jest.spyOn(catalogClient, 'createProcessingRequest');

    await request(app.getHttpServer())
      .post(`/uploads/${upload.uploadId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'key-1')
      .send({ sourceStorageKey: 'sources/bob/their-video.mp4' })
      .expect(201);

    expect(createSpy).toHaveBeenCalledWith('alice', upload.key, 'key-1');
    expect(upload.key).toBe(`sources/alice/${upload.uploadId}.mp4`);
  });
});
