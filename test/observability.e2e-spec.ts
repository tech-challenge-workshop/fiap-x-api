import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CATALOG_CLIENT } from '../src/processing-requests/ports/catalog-client.port';
import { HttpCatalogClient } from '../src/processing-requests/adapters/http-catalog-client.adapter';
import { InMemoryUploadStorage } from '../src/storage/in-memory-upload-storage';
import { UPLOAD_STORAGE } from '../src/storage/upload-storage.port';
import { apiMetrics } from '../src/observability/metrics';
import { TestIdentityProvider } from './support/test-identity-provider';
import { TestStorageEnv } from './support/test-storage';
import { listenOnLoopback } from './support/listen';
import {
  startUpload,
  StartedTestUpload,
  uploadParts,
} from './support/upload-flow';

interface CapturedCreate {
  headers: Record<string, unknown>;
  body: Record<string, unknown>;
}

/**
 * Stands in for the Catalog over real HTTP so this suite can assert the
 * wire: the create endpoint captures every request and answers 201; the
 * archive endpoint always 404s, which is the foreign-owner denial.
 */
function buildCatalogFake() {
  let server: Server;
  let baseUrl = '';
  let sequence = 0;
  const creates: CapturedCreate[] = [];

  return {
    creates,
    async start(): Promise<void> {
      server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          if (req.method === 'POST' && req.url === '/processing-requests') {
            sequence += 1;
            creates.push({
              headers: req.headers,
              body: JSON.parse(
                Buffer.concat(chunks).toString('utf8'),
              ) as Record<string, unknown>,
            });
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                processingRequestId: `pr-${sequence}`,
                status: 'RECEIVED',
              }),
            );
            return;
          }
          if (req.method === 'GET' && req.url?.endsWith('/archive')) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                message: 'Processing request not found',
                error: 'Not Found',
                statusCode: 404,
              }),
            );
            return;
          }
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Not Found', statusCode: 404 }));
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    baseUrl: () => baseUrl,
    async stop(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    reset(): void {
      creates.length = 0;
    },
  };
}

interface CapturedStdout<T> {
  value: T;
  lines: string[];
  text: string;
}

/**
 * Swaps process.stdout.write while `fn` runs and keeps every chunk pino
 * wrote, so a suite can assert the real log stream. Pino's destination
 * flushes asynchronously; `until` (default: an access-log completion line)
 * polls the captured text for up to two seconds before restoring, so a slow
 * flush can never race the assertion.
 */
async function withCapturedStdout<T>(
  fn: () => Promise<T>,
  until: (text: string) => boolean = (text) =>
    text.includes('"msg":"request completed"'),
): Promise<CapturedStdout<T>> {
  const chunks: string[] = [];
  const stdout = process.stdout as unknown as {
    write: (chunk: unknown) => boolean;
  };
  const original = stdout.write.bind(process.stdout);
  stdout.write = (chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  };
  let value: T;
  try {
    value = await fn();
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !until(chunks.join(''))) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    stdout.write = original;
  }
  const text = chunks.join('');
  return {
    value,
    text,
    lines: text.split('\n').filter((line) => line.trim().length > 0),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Pino writes through process.stdout only when the stream looks "tampered"
// (pino's hasBeenTampered check); otherwise it takes a raw fd destination
// no test can intercept. Mark it tampered at import time so the capture
// helper can swap the write method per test, whatever jest's worker setup.
const stdoutStream = process.stdout as unknown as {
  write: (chunk: unknown, ...args: unknown[]) => boolean;
};
const stdoutPrototype = Object.getPrototypeOf(stdoutStream) as {
  write: (chunk: unknown, ...args: unknown[]) => boolean;
};
if (stdoutStream.write === stdoutPrototype.write) {
  const passthrough = stdoutStream.write.bind(process.stdout);
  stdoutStream.write = (chunk: unknown, ...args: unknown[]) =>
    passthrough(chunk, ...args);
}

describe('Observability (e2e)', () => {
  const idp = new TestIdentityProvider();
  const storageEnv = new TestStorageEnv();
  const catalog = buildCatalogFake();
  let app: INestApplication<App>;
  let storage: InMemoryUploadStorage;
  let alice: string;
  let bob: string;
  let keySequence = 0;

  const nextKey = () => {
    keySequence += 1;
    return `obs-key-${keySequence}`;
  };

  /** Starts and fully uploads a 1-byte upload; the confirm is the caller's. */
  const uploaded = async (token: string): Promise<StartedTestUpload> => {
    const upload = await startUpload(app, storage, token, 1);
    uploadParts(storage, upload, 1);
    return upload;
  };

  const confirmWith = (
    token: string,
    uploadId: string,
    headers: Record<string, string>,
  ) => {
    const req = request(app.getHttpServer())
      .post(`/uploads/${uploadId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey());
    for (const [name, value] of Object.entries(headers)) {
      req.set(name, value);
    }
    return req.send();
  };

  beforeAll(async () => {
    await idp.start();
    storageEnv.set();
    await catalog.start();
    alice = await idp.token({ sub: 'alice', email: 'alice@fiapx.local' });
    bob = await idp.token({ sub: 'bob', email: 'bob@fiapx.local' });
  });

  afterAll(async () => {
    storageEnv.restore();
    await catalog.stop();
    await idp.stop();
  });

  beforeEach(async () => {
    apiMetrics.resetMetrics();
    catalog.reset();
    storage = new InMemoryUploadStorage();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UPLOAD_STORAGE)
      .useValue(storage)
      .overrideProvider(CATALOG_CLIENT)
      .useValue(new HttpCatalogClient(catalog.baseUrl()))
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await listenOnLoopback(app);
  });

  afterEach(async () => {
    apiMetrics.resetMetrics();
    await app.close();
  });

  it('answers /health and /health/live 200 without a token', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, {
      status: 'ok',
    });
    await request(app.getHttpServer()).get('/health/live').expect(200, {
      status: 'ok',
    });
  });

  it('answers GET /metrics 200 without a token, in exposition format', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);

    expect(res.headers['content-type']).toBe('text/plain; version=0.0.4');
    for (const family of [
      'fiapx_uploads_total',
      'fiapx_downloads_total',
      'fiapx_http_requests_total',
      'fiapx_http_request_duration_seconds',
    ]) {
      expect(res.text).toContain(`# HELP ${family}`);
    }
  });

  it('echoes a valid inbound correlation id on the response', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('X-Correlation-Id', 'demo-123')
      .expect(200);

    expect(res.headers['x-correlation-id']).toBe('demo-123');
  });

  it('forwards the correlation id to the catalog over header and body', async () => {
    const upload = await uploaded(alice);

    await confirmWith(alice, upload.uploadId, {
      'X-Correlation-Id': 'demo-123',
    }).expect(201);

    expect(catalog.creates).toHaveLength(1);
    expect(catalog.creates[0].headers['x-correlation-id']).toBe('demo-123');
    expect(catalog.creates[0].body.correlationId).toBe('demo-123');
  });

  it('replaces an overlong correlation id and echoes the generated one', async () => {
    const upload = await uploaded(alice);
    const overlong = 'x'.repeat(129);

    const res = await confirmWith(alice, upload.uploadId, {
      'X-Correlation-Id': overlong,
    }).expect(201);

    const echoed = res.headers['x-correlation-id'];
    expect(echoed).not.toBe(overlong);
    expect(echoed).toMatch(UUID);
    expect(catalog.creates[0].headers['x-correlation-id']).toBe(echoed);
    expect(catalog.creates[0].body.correlationId).toBe(echoed);
  });

  it('replaces a blank correlation id', async () => {
    const upload = await uploaded(alice);

    const res = await confirmWith(alice, upload.uploadId, {
      'X-Correlation-Id': '   ',
    }).expect(201);

    const echoed = res.headers['x-correlation-id'];
    expect(echoed).toMatch(UUID);
    expect(catalog.creates[0].body.correlationId).toBe(echoed);
  });

  it('logs one JSON line per event, every line carrying the correlation id', async () => {
    const upload = await uploaded(alice);

    const { lines } = await withCapturedStdout(() =>
      confirmWith(alice, upload.uploadId, {
        'X-Correlation-Id': 'demo-123',
      }).expect(201),
    );

    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed['service']).toBe('fiap-x-api');
      expect(typeof parsed['timestamp']).toBe('number');
      expect(typeof parsed['msg']).toBe('string');
      expect(parsed['correlationId']).toBe('demo-123');
    }
  });

  it('never logs the bearer token', async () => {
    const upload = await uploaded(alice);

    const { text } = await withCapturedStdout(() =>
      confirmWith(alice, upload.uploadId, {
        'X-Correlation-Id': 'demo-123',
      }).expect(201),
    );

    expect(text).not.toContain(alice);
    expect(text).not.toContain('authorization');
  });

  it('never logs the owner email', async () => {
    const upload = await uploaded(alice);

    const { text } = await withCapturedStdout(() =>
      confirmWith(alice, upload.uploadId, {
        'X-Correlation-Id': 'demo-123',
      }).expect(201),
    );

    expect(text).not.toContain('alice@fiapx.local');
  });

  it('never logs a zip storage key', async () => {
    const upload = await uploaded(alice);
    await confirmWith(alice, upload.uploadId, {
      'X-Correlation-Id': 'demo-123',
    }).expect(201);

    const { text } = await withCapturedStdout(() =>
      request(app.getHttpServer())
        .get('/processing-requests/pr-1/download')
        .set('Authorization', `Bearer ${bob}`)
        .expect(404),
    );

    expect(text).not.toContain('zipStorageKey');
    expect(text).not.toContain('zips/');
  });

  it('writes no access log line for the excluded endpoints', async () => {
    const { text } = await withCapturedStdout(
      async () => {
        await request(app.getHttpServer()).get('/health').expect(200);
        await request(app.getHttpServer()).get('/health/live').expect(200);
        await request(app.getHttpServer()).get('/metrics').expect(200);
      },
      () => true,
    );

    expect(text).not.toContain('request completed');
    expect(text).not.toContain('request errored');
  });

  it('exposes the four metric families with exactly the traffic-mix outcomes', async () => {
    const upload = await startUpload(app, storage, alice, 1);
    uploadParts(storage, upload, 1);
    await request(app.getHttpServer())
      .post(`/uploads/${upload.uploadId}/complete`)
      .set('Authorization', `Bearer ${alice}`)
      .set('Idempotency-Key', nextKey())
      .expect(201);

    // One upload rejected at the edge: sizeBytes below the bound.
    await request(app.getHttpServer())
      .post('/uploads')
      .set('Authorization', `Bearer ${alice}`)
      .send({ fileName: 'clip.mp4', contentType: 'video/mp4', sizeBytes: 0 })
      .expect(400);

    // One download attempt by a non-owner: the catalog 404s the archive.
    await request(app.getHttpServer())
      .get('/processing-requests/pr-1/download')
      .set('Authorization', `Bearer ${bob}`)
      .expect(404);

    const res = await request(app.getHttpServer()).get('/metrics').expect(200);

    expect(res.headers['content-type']).toBe('text/plain; version=0.0.4');
    expect(res.text).toContain('fiapx_uploads_total{outcome="accepted"} 1');
    expect(res.text).toContain('fiapx_uploads_total{outcome="rejected"} 1');
    expect(res.text).not.toContain('outcome="authorized"');
    expect(res.text).toContain('fiapx_downloads_total{outcome="denied"} 1');
    expect(res.text).toContain(
      'fiapx_http_requests_total{method="POST",route="/uploads",status="400"} 1',
    );
    expect(res.text).toContain(
      'fiapx_http_requests_total{method="GET",route="/processing-requests/:id/download",status="404"} 1',
    );
    expect(res.text).toContain(
      'fiapx_http_request_duration_seconds_count{method="GET",route="/processing-requests/:id/download",status="404"} 1',
    );
  });
});
