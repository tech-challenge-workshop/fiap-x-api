import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { CATALOG_CLIENT } from './../src/processing-requests/services/create-processing-request.service';
import { InMemoryCatalogClient } from './../src/processing-requests/adapters/in-memory-catalog-client.adapter';
import { TestIdentityProvider } from './support/test-identity-provider';
import { countCatalogCalls } from './support/catalog-calls';

describe('GET /processing-requests/:id (e2e)', () => {
  const idp = new TestIdentityProvider();
  let app: INestApplication<App>;
  let catalogClient: InMemoryCatalogClient;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    await idp.start();
    alice = await idp.token({ sub: 'alice' });
    bob = await idp.token({ sub: 'bob' });
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

  afterEach(async () => {
    await app.close();
  });

  const createAsAlice = async (): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/processing-requests')
      .set('Authorization', `Bearer ${alice}`)
      .send({ sourceStorageKey: 'sources/alice/clip.mp4' })
      .expect(201);
    return (res.body as { processingRequestId: string }).processingRequestId;
  };

  const read = (token: string, id: string) =>
    request(app.getHttpServer())
      .get(`/processing-requests/${encodeURIComponent(id)}`)
      .set('Authorization', `Bearer ${token}`);

  it('returns the owner their request as id, status and timestamps only (AC P4.1)', async () => {
    const id = await createAsAlice();

    const res = await read(alice, id).expect(200);

    const body = res.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'createdAt',
      'processingRequestId',
      'status',
      'updatedAt',
    ]);
    expect(body.processingRequestId).toBe(id);
    expect(body.status).toBe('RECEIVED');
    expect(new Date(body.createdAt as string).toISOString()).toBe(
      body.createdAt,
    );
    // The in-memory id embeds the key, so check values, not the raw text.
    expect(Object.values(body)).not.toContain('sources/alice/clip.mp4');
  });

  it("answers another user's id, a random UUID and a malformed id with byte-identical 404s (AC P4.2, P4.3)", async () => {
    const id = await createAsAlice();
    const getSpy = jest.spyOn(catalogClient, 'getOwned');

    const otherUsers = await read(bob, id).expect(404);
    const randomUuid = await read(
      bob,
      '3f2b8c1e-9d4a-4e6b-8f1a-2c3d4e5f6a7b',
    ).expect(404);
    const malformed = await read(bob, 'not-a-uuid').expect(404);

    expect(otherUsers.body).toEqual({
      statusCode: 404,
      message: 'Processing request not found',
    });
    expect(randomUuid.text).toBe(otherUsers.text);
    expect(malformed.text).toBe(otherUsers.text);
    expect(randomUuid.headers['content-type']).toBe(
      otherUsers.headers['content-type'],
    );
    expect(getSpy).toHaveBeenNthCalledWith(1, 'bob', id);
  });

  it('responds 502 when the Catalog fails (AC P4.4)', async () => {
    const id = await createAsAlice();
    catalogClient.setNextRequestShouldReject(true);

    const res = await read(alice, id).expect(502);

    expect(res.body).toEqual({
      statusCode: 502,
      message: 'Catalog unavailable',
    });
  });

  it('responds 401 without a token and does not call the Catalog (AC P1.1)', async () => {
    const catalogCalls = countCatalogCalls(catalogClient);

    const res = await request(app.getHttpServer())
      .get('/processing-requests/3f2b8c1e-9d4a-4e6b-8f1a-2c3d4e5f6a7b')
      .expect(401);

    expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    expect(catalogCalls()).toBe(0);
  });
});
