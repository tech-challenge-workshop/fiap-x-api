import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  LoggerService,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { CATALOG_CLIENT } from './../src/processing-requests/ports/catalog-client.port';
import { InMemoryCatalogClient } from './../src/processing-requests/adapters/in-memory-catalog-client.adapter';
import { InMemoryUploadStorage } from './../src/storage/in-memory-upload-storage';
import { UPLOAD_STORAGE } from './../src/storage/upload-storage.port';
import { TestIdentityProvider } from './support/test-identity-provider';
import { TestStorageEnv } from './support/test-storage';
import { createSigningKey, SigningKey } from './support/jwks-server';
import { signToken, tamperPayload } from './support/tokens';
import { countCatalogCalls } from './support/catalog-calls';

class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  private capture = (...args: unknown[]) => {
    this.lines.push(args.map((arg) => String(arg)).join(' '));
  };
  log = this.capture;
  error = this.capture;
  warn = this.capture;
  debug = this.capture;
  verbose = this.capture;
  fatal = this.capture;
}

describe('Authentication (e2e)', () => {
  const idp = new TestIdentityProvider();
  const storageEnv = new TestStorageEnv();
  let rogueKey: SigningKey;
  let app: INestApplication<App>;
  let catalogCalls: () => number;
  let logger: CapturingLogger;

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    await idp.start();
    storageEnv.set();
    rogueKey = await createSigningKey('rogue-key');
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
    logger = new CapturingLogger();
    app.useLogger(logger);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    catalogCalls = countCatalogCalls(
      moduleFixture.get<InMemoryCatalogClient>(CATALOG_CLIENT),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  /** A protected route that reaches the Catalog (the S5 create route is gone). */
  const callProtected = (authorization?: string) => {
    const req = request(app.getHttpServer()).get('/processing-requests');
    if (authorization !== undefined) {
      void req.set('Authorization', authorization);
    }
    return req.send();
  };

  it('accepts a valid bearer token and reaches the Catalog', async () => {
    const res = await callProtected(`Bearer ${await idp.token()}`);

    expect(res.status).toBe(200);
    expect(catalogCalls()).toBe(1);
  });

  it.each<[string]>([['bearer'], ['BEARER']])(
    'accepts the scheme written as %s and reaches the Catalog (AC P5.1)',
    async (scheme) => {
      const res = await callProtected(`${scheme} ${await idp.token()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
      expect(catalogCalls()).toBe(1);
    },
  );

  it.each<[string, () => Promise<string | undefined>]>([
    ['no Authorization header (AC P1.1)', () => Promise.resolve(undefined)],
    [
      'a scheme other than Bearer (edge case)',
      () => Promise.resolve('Basic YWxpY2U6c2VjcmV0'),
    ],
    [
      // Only the scheme check can reject this one: the token itself is valid,
      // so dropping that check would let it through.
      'a valid token under a scheme other than Bearer (edge case)',
      async () => `Basic ${await idp.token()}`,
    ],
    [
      // A second representative of "any scheme other than Bearer", so a guard
      // that only singles out Basic is still caught.
      'a valid token under the Token scheme (edge case)',
      async () => `Token ${await idp.token()}`,
    ],
    ['Bearer with no token (AC P1.1)', () => Promise.resolve('Bearer ')],
    ['Bearer alone (near-miss of AC P5.1)', () => Promise.resolve('Bearer')],
    [
      'a tampered token (AC P1.2)',
      async () => `Bearer ${tamperPayload(await idp.token())}`,
    ],
    [
      'a token signed by a key the provider does not publish (AC P1.2)',
      async () => `Bearer ${await signToken(rogueKey)}`,
    ],
    [
      'an expired token (AC P1.3)',
      async () => `Bearer ${await idp.token({ exp: nowSeconds() - 1 })}`,
    ],
    [
      'a token from another issuer (AC P1.4)',
      async () =>
        `Bearer ${await idp.token({ iss: 'http://evil.test/realms/x' })}`,
    ],
    [
      'a token for another audience (AC P1.5)',
      async () => `Bearer ${await idp.token({ aud: 'another-client' })}`,
    ],
    [
      'a token without sub (AC P1.6)',
      async () => `Bearer ${await idp.token({ sub: undefined })}`,
    ],
    [
      'a validly signed token without exp (edge case)',
      async () => `Bearer ${await idp.token({ exp: undefined })}`,
    ],
    [
      // Without iat as well, so a rule that demands exp only when iat is
      // present is still caught.
      'a validly signed token without exp or iat (edge case)',
      async () =>
        `Bearer ${await idp.token({ exp: undefined, iat: undefined })}`,
    ],
  ])('responds 401 without calling the Catalog for %s', async (_, header) => {
    const res = await callProtected(await header());

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    expect(catalogCalls()).toBe(0);
  });

  it('responds 503 without calling the Catalog when the provider is down and no key is cached (AC P1.7)', async () => {
    const token = await idp.token();
    await idp.server.stop();
    try {
      const res = await callProtected(`Bearer ${token}`);

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        statusCode: 503,
        message: 'Authentication temporarily unavailable',
      });
      expect(catalogCalls()).toBe(0);
    } finally {
      await idp.server.start();
    }
  });

  it('serves /health without a token (AC P1.10)', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('protects a route that is not marked public', async () => {
    await request(app.getHttpServer()).get('/').expect(401);
  });

  it('never logs a valid token sent under a scheme other than Bearer (AC P4.2)', async () => {
    const token = await idp.token();

    const res = await callProtected(`Token ${token}`);

    expect(res.status).toBe(401);
    const logs = logger.lines.join('\n');
    expect(logs).toContain('Authentication rejected: no bearer token');
    expect(logs).not.toContain(token);
    for (const segment of token.split('.')) {
      expect(logs).not.toContain(segment);
    }
  });

  it('never logs the token or its signature, only the rejection class', async () => {
    const tampered = tamperPayload(await idp.token());
    const rogue = await signToken(rogueKey);

    await callProtected(`Bearer ${tampered}`).expect(401);
    await callProtected(`Bearer ${rogue}`).expect(401);

    const logs = logger.lines.join('\n');
    expect(logs).toContain('JWSSignatureVerificationFailed');
    expect(logs).toContain('JWKSNoMatchingKey');
    for (const token of [tampered, rogue]) {
      const [header, payload, signature] = token.split('.');
      expect(logs).not.toContain(signature);
      expect(logs).not.toContain(payload);
      expect(logs).not.toContain(header);
    }
  });
});
