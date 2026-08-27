import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { CATALOG_CLIENT } from './../src/processing-requests/services/create-processing-request.service';
import { InMemoryCatalogClient } from './../src/processing-requests/adapters/in-memory-catalog-client.adapter';

describe('CreateProcessingRequestController (e2e)', () => {
  let app: INestApplication<App>;
  let catalogClient: InMemoryCatalogClient;

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
    catalogClient = moduleFixture.get<CATALOG_CLIENT>(
      CATALOG_CLIENT,
    ) as InMemoryCatalogClient;
    await app.init();
  });

  it('returns 201 and a processingRequestId for valid input', () => {
    return request(app.getHttpServer())
      .post('/processing-requests')
      .send({
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/clip.mp4',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.processingRequestId).toContain('user-123');
        expect(res.body.processingRequestId).toContain('videos/clip.mp4');
      });
  });

  it('returns 400 when ownerUserId is missing', () => {
    return request(app.getHttpServer())
      .post('/processing-requests')
      .send({
        sourceStorageKey: 'videos/clip.mp4',
      })
      .expect(400);
  });

  it('returns 400 when sourceStorageKey is missing', () => {
    return request(app.getHttpServer())
      .post('/processing-requests')
      .send({
        ownerUserId: 'user-123',
      })
      .expect(400);
  });

  it('returns 400 when both fields are missing', () => {
    return request(app.getHttpServer())
      .post('/processing-requests')
      .send({})
      .expect(400);
  });

  it('returns 502 when the catalog rejects creation', () => {
    catalogClient.setNextRequestShouldReject(true);

    return request(app.getHttpServer())
      .post('/processing-requests')
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
