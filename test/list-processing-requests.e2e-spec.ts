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
import { createThroughUpload } from './support/upload-flow';

interface ListBody {
  items: Record<string, unknown>[];
  page: number;
  pageSize: number;
  total: number;
}

const PAGE_MESSAGE = 'page must be an integer greater than or equal to 1';
const PAGE_SIZE_MESSAGE = 'pageSize must be an integer between 1 and 100';

describe('GET /processing-requests (e2e)', () => {
  const idp = new TestIdentityProvider();
  const storageEnv = new TestStorageEnv();
  let app: INestApplication<App>;
  let catalogClient: InMemoryCatalogClient;
  let storage: InMemoryUploadStorage;
  let alice: string;
  let bob: string;
  let carol: string;

  beforeAll(async () => {
    await idp.start();
    storageEnv.set();
    alice = await idp.token({ sub: 'alice' });
    bob = await idp.token({ sub: 'bob' });
    carol = await idp.token({ sub: 'carol' });
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

  /** Creates through the upload flow, so ownership comes from the token. */
  const create = async (token: string): Promise<string> =>
    (await createThroughUpload(app, storage, token)).processingRequestId;

  const list = (token: string, query = '') =>
    request(app.getHttpServer())
      .get(`/processing-requests${query}`)
      .set('Authorization', `Bearer ${token}`);

  const ids = (body: ListBody) =>
    body.items.map((item) => item.processingRequestId);

  it("returns only the caller's requests, newest first, with defaults page 1 and pageSize 20 (AC P3.1-P3.4)", async () => {
    const a1 = await create(alice);
    const b1 = await create(bob);
    const a2 = await create(alice);
    const a3 = await create(alice);
    const b2 = await create(bob);
    const listSpy = jest.spyOn(catalogClient, 'listOwned');

    const aliceRes = await list(alice).expect(200);
    const bobRes = await list(bob).expect(200);

    const aliceBody = aliceRes.body as ListBody;
    const bobBody = bobRes.body as ListBody;
    expect(ids(aliceBody)).toEqual([a3, a2, a1]);
    expect(aliceBody).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(ids(bobBody)).toEqual([b2, b1]);
    expect(bobBody).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(Object.keys(aliceBody).sort()).toEqual([
      'items',
      'page',
      'pageSize',
      'total',
    ]);
    expect(listSpy).toHaveBeenNthCalledWith(1, 'alice', 1, 20);
    expect(listSpy).toHaveBeenNthCalledWith(2, 'bob', 1, 20);
  });

  it('pages with the requested page and pageSize', async () => {
    const a1 = await create(alice);
    const a2 = await create(alice);
    await create(alice);

    const res = await list(alice, '?page=2&pageSize=2').expect(200);

    expect(res.body).toEqual({
      items: [expect.objectContaining({ processingRequestId: a1 })],
      page: 2,
      pageSize: 2,
      total: 3,
    });
    expect(ids(res.body as ListBody)).not.toContain(a2);
  });

  it('returns items: [] with the true total beyond the last page (AC P3.9)', async () => {
    await create(alice);
    await create(alice);

    const res = await list(alice, '?page=5&pageSize=1').expect(200);

    expect(res.body).toEqual({ items: [], page: 5, pageSize: 1, total: 2 });
  });

  it('returns 200 with items: [] and total 0 for a user with no requests (edge case)', async () => {
    await create(alice);

    const res = await list(carol).expect(200);

    expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it('shows each item as id, status and timestamps only, never storage keys or the owner (AC P3.5, P3.6)', async () => {
    const { key } = await createThroughUpload(app, storage, alice);

    const res = await list(alice).expect(200);

    const [item] = (res.body as ListBody).items;
    expect(Object.keys(item).sort()).toEqual([
      'createdAt',
      'processingRequestId',
      'status',
      'updatedAt',
    ]);
    expect(item.status).toBe('RECEIVED');
    expect(new Date(item.createdAt as string).toISOString()).toBe(
      item.createdAt,
    );
    expect(new Date(item.updatedAt as string).toISOString()).toBe(
      item.updatedAt,
    );
    for (const forbidden of [
      'sourceStorageKey',
      'zipStorageKey',
      'failureCode',
      'attemptId',
      'ownerUserId',
      key,
    ]) {
      expect(res.text).not.toContain(`"${forbidden}"`);
    }
  });

  it.each<[string, string[]]>([
    ['?page=0', [PAGE_MESSAGE]],
    ['?page=-1', [PAGE_MESSAGE]],
    ['?page=abc', [PAGE_MESSAGE]],
    ['?page=1.5', [PAGE_MESSAGE]],
    ['?page=', [PAGE_MESSAGE]],
    ['?page=1&page=2', [PAGE_MESSAGE]],
    ['?pageSize=0', [PAGE_SIZE_MESSAGE]],
    ['?pageSize=101', [PAGE_SIZE_MESSAGE]],
    ['?pageSize=abc', [PAGE_SIZE_MESSAGE]],
    ['?page=0&pageSize=101', [PAGE_MESSAGE, PAGE_SIZE_MESSAGE]],
  ])(
    'responds 400 naming the parameter and its range for %s, without calling the Catalog (AC P3.7, P3.8)',
    async (query, messages) => {
      const catalogCalls = countCatalogCalls(catalogClient);

      const res = await list(alice, query).expect(400);

      expect(res.body).toEqual({ statusCode: 400, message: messages });
      expect(catalogCalls()).toBe(0);
    },
  );

  it('accepts the bounds page=1, pageSize=1 and pageSize=100', async () => {
    await list(alice, '?page=1&pageSize=1').expect(200);
    const res = await list(alice, '?pageSize=100').expect(200);

    expect(res.body).toMatchObject({ page: 1, pageSize: 100 });
  });

  it('responds 502 when the Catalog fails (AC P3.10)', async () => {
    catalogClient.setNextRequestShouldReject(true);

    const res = await list(alice).expect(502);

    expect(res.body).toEqual({
      statusCode: 502,
      message: 'Catalog unavailable',
    });
  });

  it('responds 401 without a token and does not call the Catalog (AC P1.1)', async () => {
    const catalogCalls = countCatalogCalls(catalogClient);

    const res = await request(app.getHttpServer())
      .get('/processing-requests')
      .expect(401);

    expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    expect(catalogCalls()).toBe(0);
  });
});
