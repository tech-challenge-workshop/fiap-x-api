import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { CATALOG_CLIENT } from './../src/processing-requests/services/create-processing-request.service';
import { InMemoryCatalogClient } from './../src/processing-requests/adapters/in-memory-catalog-client.adapter';
import { TestIdentityProvider } from './support/test-identity-provider';
import { createSigningKey, SigningKey } from './support/jwks-server';
import { signToken } from './support/tokens';
import { countCatalogCalls } from './support/catalog-calls';

/**
 * The identity provider goes down after the app has authenticated once:
 * a key it already holds keeps working, a key it never saw is a 503 (our
 * fault, not the caller's), and the new key works once the provider is back.
 */
describe('Identity provider outage (e2e)', () => {
  const idp = new TestIdentityProvider();
  let newKey: SigningKey;
  let app: INestApplication<App>;
  let catalogClient: InMemoryCatalogClient;

  beforeAll(async () => {
    await idp.start();
    newKey = await createSigningKey('rotated-in-key');
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
    // Leave the provider up and serving only its original key.
    await idp.server.stop();
    await idp.server.start();
    idp.server.serveKeys(idp.key);
  });

  const list = (token: string) =>
    request(app.getHttpServer())
      .get('/processing-requests')
      .set('Authorization', `Bearer ${token}`);

  /** Authenticates once, so the app caches the provider's current key. */
  const authenticateOnceThenStopProvider = async () => {
    await list(await idp.token()).expect(200);
    await idp.server.stop();
  };

  it('keeps accepting a token signed by an already-cached key while the provider is down (AC P1.8)', async () => {
    await authenticateOnceThenStopProvider();
    const listSpy = jest.spyOn(catalogClient, 'listOwned');

    const res = await list(await idp.token({ sub: 'bob' })).expect(200);

    expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    expect(listSpy).toHaveBeenCalledWith('bob', 1, 20);
  });

  it('responds 503 without calling the Catalog for a token signed by a key it never fetched (AC P1.7)', async () => {
    await authenticateOnceThenStopProvider();
    const catalogCalls = countCatalogCalls(catalogClient);

    const res = await list(await signToken(newKey)).expect(503);

    expect(res.body).toEqual({
      statusCode: 503,
      message: 'Authentication temporarily unavailable',
    });
    expect(catalogCalls()).toBe(0);
  });

  it('accepts the new key once the provider is back and serving it', async () => {
    await authenticateOnceThenStopProvider();
    const token = await signToken(newKey, { sub: 'carol' });
    await list(token).expect(503);

    await idp.server.start();
    idp.server.serveKeys(idp.key, newKey);
    const listSpy = jest.spyOn(catalogClient, 'listOwned');

    const res = await list(token).expect(200);

    expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    expect(listSpy).toHaveBeenCalledWith('carol', 1, 20);
  });
});
