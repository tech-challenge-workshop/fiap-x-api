import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request, { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { CATALOG_CLIENT } from './../src/processing-requests/services/create-processing-request.service';
import { InMemoryCatalogClient } from './../src/processing-requests/adapters/in-memory-catalog-client.adapter';
import { TestIdentityProvider } from './support/test-identity-provider';

describe('CreateProcessingRequestController (e2e)', () => {
  const idp = new TestIdentityProvider();
  let app: INestApplication<App>;
  let catalogClient: InMemoryCatalogClient;
  let token: string;

  beforeAll(async () => {
    await idp.start();
    token = await idp.token();
  });

  afterAll(async () => {
    await idp.stop();
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
        expect(body.processingRequestId).toContain('user-123');
        expect(body.processingRequestId).toContain('videos/clip.mp4');
        expect(body.status).toBe('RECEIVED');
      });
  });

  it('returns 400 when ownerUserId is missing', () => {
    return request(app.getHttpServer())
      .post('/processing-requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceStorageKey: 'videos/clip.mp4',
      })
      .expect(400);
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
