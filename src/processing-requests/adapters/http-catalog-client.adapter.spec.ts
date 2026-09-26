import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { HttpCatalogClient } from './http-catalog-client.adapter';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';

describe('HttpCatalogClient', () => {
  const baseUrl = 'http://catalog:3001';
  let client: HttpCatalogClient;
  let fetchSpy: jest.SpyInstance<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >;

  beforeEach(() => {
    client = new HttpCatalogClient(baseUrl);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const successResponse = () =>
    Promise.resolve({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          processingRequestId: 'pr-123',
          status: 'RECEIVED',
        }),
    } as unknown as Response);

  it('returns the created request and sends owner, key and idempotency key', async () => {
    fetchSpy.mockResolvedValue(successResponse());

    const result = await client.createProcessingRequest(
      'user-1',
      'source-1',
      'idem-1',
    );

    expect(result).toEqual({
      outcome: 'created',
      processingRequestId: 'pr-123',
      status: 'RECEIVED',
    });
    expect(fetchSpy).toHaveBeenCalledWith(`${baseUrl}/processing-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerUserId: 'user-1',
        sourceStorageKey: 'source-1',
        idempotencyKey: 'idem-1',
      }),
    });
  });

  it('throws CatalogUnavailableError when fetch fails', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));

    await expect(
      client.createProcessingRequest('user-1', 'source-1', 'idem-1'),
    ).rejects.toThrow(CatalogUnavailableError);
  });

  it('throws CatalogUnavailableError on non-2xx response', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      json: () =>
        Promise.resolve({
          processingRequestId: 'pr-123',
          status: 'RECEIVED',
        }),
    } as unknown as Response);

    await expect(
      client.createProcessingRequest('user-1', 'source-1', 'idem-1'),
    ).rejects.toThrow(CatalogUnavailableError);
  });

  it('throws CatalogUnavailableError on malformed JSON response', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ unexpected: 'shape' }),
    } as unknown as Response);

    await expect(
      client.createProcessingRequest('user-1', 'source-1', 'idem-1'),
    ).rejects.toThrow(CatalogUnavailableError);
  });
});

describe('HttpCatalogClient owner-scoped reads (local server)', () => {
  type Reply = { status: number; body: string };
  let server: Server;
  let baseUrl: string;
  let requestedUrls: string[];
  let reply: Reply;

  const json = (status: number, body: unknown): Reply => ({
    status,
    body: JSON.stringify(body),
  });

  const item = {
    processingRequestId: '7d4f1c1e-0000-4000-8000-000000000001',
    status: 'FAILED',
    createdAt: '2026-09-26T10:00:00.000Z',
    updatedAt: '2026-09-26T10:05:00.000Z',
    failureReason: 'The video could not be processed',
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      requestedUrls.push(req.url ?? '');
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(reply.body);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    requestedUrls = [];
  });

  /** A base URL on which nothing listens: every fetch fails at the network. */
  const unreachableBaseUrl = async (): Promise<string> => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return `http://127.0.0.1:${port}`;
  };

  describe('listOwned', () => {
    it('returns the Catalog page and asks for the owner, page and pageSize', async () => {
      const page = { items: [item], page: 2, pageSize: 5, total: 6 };
      reply = json(200, page);

      const result = await new HttpCatalogClient(baseUrl).listOwned(
        'alice',
        2,
        5,
      );

      expect(result).toEqual(page);
      expect(requestedUrls).toEqual([
        '/owners/alice/processing-requests?page=2&pageSize=5',
      ]);
    });

    it('URL-encodes the owner in the path', async () => {
      reply = json(200, { items: [], page: 1, pageSize: 20, total: 0 });

      await new HttpCatalogClient(baseUrl).listOwned('a/b c?d', 1, 20);

      expect(requestedUrls).toEqual([
        '/owners/a%2Fb%20c%3Fd/processing-requests?page=1&pageSize=20',
      ]);
    });

    it.each<[string, Reply]>([
      ['a 500', json(500, { statusCode: 500, message: 'boom' })],
      ['a 404', json(404, { statusCode: 404, message: 'Not Found' })],
      ['a body that is not JSON', { status: 200, body: 'not json' }],
      [
        'items that are not an array',
        json(200, { items: {}, page: 1, pageSize: 20, total: 0 }),
      ],
      ['a missing total', json(200, { items: [], page: 1, pageSize: 20 })],
      [
        'an item without status',
        json(200, {
          items: [{ ...item, status: undefined }],
          page: 1,
          pageSize: 20,
          total: 1,
        }),
      ],
    ])('throws CatalogUnavailableError on %s', async (_, response) => {
      reply = response;

      await expect(
        new HttpCatalogClient(baseUrl).listOwned('alice', 1, 20),
      ).rejects.toThrow(CatalogUnavailableError);
    });

    it('throws CatalogUnavailableError when the Catalog is unreachable', async () => {
      const client = new HttpCatalogClient(await unreachableBaseUrl());

      await expect(client.listOwned('alice', 1, 20)).rejects.toThrow(
        CatalogUnavailableError,
      );
    });
  });

  describe('getOwned', () => {
    it('returns the Catalog item, asking under the owner with the id encoded', async () => {
      reply = json(200, item);

      const result = await new HttpCatalogClient(baseUrl).getOwned(
        'a/b',
        'x/y',
      );

      expect(result).toEqual(item);
      expect(requestedUrls).toEqual([
        '/owners/a%2Fb/processing-requests/x%2Fy',
      ]);
    });

    it('returns undefined when the Catalog answers 404', async () => {
      reply = json(404, {
        message: 'Processing request not found',
        error: 'Not Found',
        statusCode: 404,
      });

      await expect(
        new HttpCatalogClient(baseUrl).getOwned(
          'alice',
          item.processingRequestId,
        ),
      ).resolves.toBeUndefined();
    });

    it.each<[string, Reply]>([
      ['a 500', json(500, { statusCode: 500, message: 'boom' })],
      [
        'a 400',
        json(400, { statusCode: 400, message: 'ownerUserId is required' }),
      ],
      ['a body that is not JSON', { status: 200, body: 'not json' }],
      [
        'an item without createdAt',
        json(200, { ...item, createdAt: undefined }),
      ],
      ['a non-string failureReason', json(200, { ...item, failureReason: 42 })],
    ])('throws CatalogUnavailableError on %s', async (_, response) => {
      reply = response;

      await expect(
        new HttpCatalogClient(baseUrl).getOwned(
          'alice',
          item.processingRequestId,
        ),
      ).rejects.toThrow(CatalogUnavailableError);
    });

    it('throws CatalogUnavailableError when the Catalog is unreachable', async () => {
      const client = new HttpCatalogClient(await unreachableBaseUrl());

      await expect(
        client.getOwned('alice', item.processingRequestId),
      ).rejects.toThrow(CatalogUnavailableError);
    });
  });

  describe('createProcessingRequest', () => {
    const created = {
      processingRequestId: '7d4f1c1e-0000-4000-8000-000000000002',
      status: 'RECEIVED',
      ownerUserId: 'alice',
      sourceStorageKey: 'sources/alice/clip.mp4',
      createdAt: '2026-09-26T10:00:00.000Z',
    };

    const create = (client = new HttpCatalogClient(baseUrl)) =>
      client.createProcessingRequest(
        'alice',
        'sources/alice/clip.mp4',
        'idem-1',
      );

    it('maps 201 to created, keeping only the id and status', async () => {
      reply = json(201, created);

      await expect(create()).resolves.toStrictEqual({
        outcome: 'created',
        processingRequestId: created.processingRequestId,
        status: 'RECEIVED',
      });
      expect(requestedUrls).toEqual(['/processing-requests']);
    });

    it('maps 200 to replayed with the same id', async () => {
      reply = json(200, created);

      await expect(create()).resolves.toStrictEqual({
        outcome: 'replayed',
        processingRequestId: created.processingRequestId,
        status: 'RECEIVED',
      });
    });

    it('maps 409 to conflict', async () => {
      reply = json(409, {
        message:
          'idempotencyKey is already used for a different sourceStorageKey',
        error: 'Conflict',
        statusCode: 409,
      });

      await expect(create()).resolves.toStrictEqual({ outcome: 'conflict' });
    });

    it.each<[string, Reply]>([
      [
        'a 400',
        json(400, { statusCode: 400, message: 'idempotencyKey is required' }),
      ],
      ['a 500', json(500, { statusCode: 500, message: 'boom' })],
      ['a 202', json(202, created)],
      ['a body that is not JSON', { status: 201, body: 'not json' }],
      [
        'a 200 without processingRequestId',
        json(200, { ...created, processingRequestId: undefined }),
      ],
    ])('throws CatalogUnavailableError on %s', async (_, response) => {
      reply = response;

      await expect(create()).rejects.toThrow(CatalogUnavailableError);
    });

    it('throws CatalogUnavailableError when the Catalog is unreachable', async () => {
      await expect(
        create(new HttpCatalogClient(await unreachableBaseUrl())),
      ).rejects.toThrow(CatalogUnavailableError);
    });
  });

  describe('getArchive', () => {
    it('returns the archive key, asking under the owner with the id encoded', async () => {
      reply = json(200, { zipStorageKey: 'zips/alice/pr-1.zip' });

      const result = await new HttpCatalogClient(baseUrl).getArchive(
        'a/b',
        'x/y',
      );

      expect(result).toStrictEqual({ zipStorageKey: 'zips/alice/pr-1.zip' });
      expect(requestedUrls).toEqual([
        '/owners/a%2Fb/processing-requests/x%2Fy/archive',
      ]);
    });

    it("returns 'not-completed' when the Catalog answers 409", async () => {
      reply = json(409, {
        message: 'Processing request is not completed',
        error: 'Conflict',
        statusCode: 409,
      });

      await expect(
        new HttpCatalogClient(baseUrl).getArchive(
          'alice',
          item.processingRequestId,
        ),
      ).resolves.toBe('not-completed');
    });

    it('returns undefined when the Catalog answers 404', async () => {
      reply = json(404, {
        message: 'Processing request not found',
        error: 'Not Found',
        statusCode: 404,
      });

      await expect(
        new HttpCatalogClient(baseUrl).getArchive(
          'alice',
          item.processingRequestId,
        ),
      ).resolves.toBeUndefined();
    });

    it.each<[string, Reply]>([
      ['a 500', json(500, { statusCode: 500, message: 'boom' })],
      [
        'a 400',
        json(400, { statusCode: 400, message: 'ownerUserId is required' }),
      ],
      ['a body that is not JSON', { status: 200, body: 'not json' }],
      ['a 200 without zipStorageKey', json(200, {})],
      ['a non-string zipStorageKey', json(200, { zipStorageKey: 42 })],
      ['an empty zipStorageKey', json(200, { zipStorageKey: '' })],
    ])('throws CatalogUnavailableError on %s', async (_, response) => {
      reply = response;

      await expect(
        new HttpCatalogClient(baseUrl).getArchive(
          'alice',
          item.processingRequestId,
        ),
      ).rejects.toThrow(CatalogUnavailableError);
    });

    it('throws CatalogUnavailableError when the Catalog is unreachable', async () => {
      const client = new HttpCatalogClient(await unreachableBaseUrl());

      await expect(
        client.getArchive('alice', item.processingRequestId),
      ).rejects.toThrow(CatalogUnavailableError);
    });
  });
});
