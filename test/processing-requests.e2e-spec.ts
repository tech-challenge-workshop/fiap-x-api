import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request, { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { CATALOG_CLIENT } from './../src/processing-requests/services/create-processing-request.service';
import { InMemoryCatalogClient } from './../src/processing-requests/adapters/in-memory-catalog-client.adapter';
import { InMemoryUploadStorage } from './../src/storage/in-memory-upload-storage';
import { UPLOAD_STORAGE } from './../src/storage/upload-storage.port';
import { TestIdentityProvider } from './support/test-identity-provider';
import { TestStorageEnv } from './support/test-storage';

describe('POST /processing-requests (e2e)', () => {
  const idp = new TestIdentityProvider();
  const storageEnv = new TestStorageEnv();
  let app: INestApplication<App>;
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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UPLOAD_STORAGE)
      .useValue(new InMemoryUploadStorage())
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

  it('returns 201 and a processingRequestId for valid input', () => {
    return request(app.getHttpServer())
      .post('/processing-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/clip.mp4',
      })
      .expect(201)
      .expect((res: Response) => {
        const body = res.body as {
          processingRequestId: string;
          status: string;
        };
        expect(body.processingRequestId).toContain('alice');
        expect(body.processingRequestId).not.toContain('user-123');
        expect(body.processingRequestId).toContain('videos/clip.mp4');
        expect(body.status).toBe('RECEIVED');
      });
  });

  it('returns 201 when ownerUserId is missing (AC P2.2)', () => {
    return request(app.getHttpServer())
      .post('/processing-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceStorageKey: 'videos/clip.mp4',
      })
      .expect(201);
  });

  it("creates as the token's sub, ignoring ownerUserId in the body, and answers only id and status (AC P2.1-P2.3)", async () => {
    const createSpy = jest.spyOn(catalogClient, 'createProcessingRequest');

    const res = await request(app.getHttpServer())
      .post('/processing-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ ownerUserId: 'bob', sourceStorageKey: 'videos/clip.mp4' })
      .expect(201);

    expect(createSpy).toHaveBeenCalledWith('alice', 'videos/clip.mp4');
    const body = res.body as Record<string, unknown>;
    expect(body).toEqual({
      processingRequestId: expect.any(String) as string,
      status: 'RECEIVED',
    });
    const alices = await catalogClient.listOwned('alice', 1, 20);
    expect(alices.items.map((item) => item.processingRequestId)).toEqual([
      body.processingRequestId,
    ]);
    expect((await catalogClient.listOwned('bob', 1, 20)).total).toBe(0);
  });

  it('returns 400 when sourceStorageKey is missing', () => {
    return request(app.getHttpServer())
      .post('/processing-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ownerUserId: 'user-123',
      })
      .expect(400);
  });

  it('returns 400 when both fields are missing', () => {
    return request(app.getHttpServer())
      .post('/processing-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });

  it('returns 502 when the catalog rejects creation', () => {
    catalogClient.setNextRequestShouldReject(true);

    return request(app.getHttpServer())
      .post('/processing-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/clip.mp4',
      })
      .expect(502);
  });

  afterEach(async () => {
    await app.close();
  });
});
