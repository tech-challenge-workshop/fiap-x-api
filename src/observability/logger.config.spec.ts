import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import pinoHttp from 'pino-http';
import { CorrelationContext } from './correlation-context';
import { buildRootLoggerConfig } from './logger.config';

function createCapturingLogger(context: CorrelationContext) {
  const raw: string[] = [];
  const sink = new Writable({
    write(chunk: unknown, _encoding, callback) {
      raw.push(String(chunk));
      callback();
    },
  });
  const config = buildRootLoggerConfig(context);
  const instance = pinoHttp(config.pinoHttp, sink);
  return {
    instance,
    raw,
    parsed: (): Record<string, unknown>[] =>
      raw.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

async function withServer(
  logger: ReturnType<typeof createCapturingLogger>,
  handler: (server: Server) => Promise<void>,
): Promise<Record<string, unknown>[]> {
  const server = createServer((req, res) =>
    logger.instance(req, res, () => {
      res.end('ok');
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await handler(server);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return logger.parsed();
}

describe('buildRootLoggerConfig', () => {
  let context: CorrelationContext;
  let logger: ReturnType<typeof createCapturingLogger>;
  const originalLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    context = new CorrelationContext();
    logger = createCapturingLogger(context);
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLogLevel;
    }
  });

  it('emits one json line per log with service and the als correlationId', () => {
    context.runWithCorrelation('demo-123', () => {
      logger.instance.logger.info('hello world');
    });

    const [line] = logger.parsed();
    expect(typeof line['timestamp']).toBe('number');
    expect(line['level']).toBe(30);
    expect(line['msg']).toBe('hello world');
    expect(line['service']).toBe('fiap-x-api');
    expect(line['correlationId']).toBe('demo-123');
  });

  it('omits the correlationId key when no correlation scope is active', () => {
    logger.instance.logger.info('no scope');

    const [line] = logger.parsed();
    expect(line['service']).toBe('fiap-x-api');
    expect(line).not.toHaveProperty('correlationId');
  });

  it('redacts email-like values under email and ownerEmail keys', () => {
    logger.instance.logger.info({
      email: 'alice@example.com',
      account: { ownerEmail: 'bob@example.com' },
      visible: 'kept',
    });

    const [line] = logger.parsed();
    expect(line).not.toHaveProperty('email');
    expect(line['account']).toEqual({});
    expect(line['visible']).toBe('kept');
    expect(logger.raw.join('')).not.toContain('alice@example.com');
    expect(logger.raw.join('')).not.toContain('bob@example.com');
  });

  it('redacts storage keys and sensitive headers while keeping the rest', () => {
    logger.instance.logger.info({
      zipStorageKey: 'zip-secret',
      sourceStorageKey: 'src-secret',
      req: {
        headers: {
          authorization: 'Bearer token-123',
          cookie: 'session=abc',
          'user-agent': 'jest',
        },
      },
    });

    const [line] = logger.parsed();
    expect(line).not.toHaveProperty('zipStorageKey');
    expect(line).not.toHaveProperty('sourceStorageKey');
    expect(line['req']).toEqual({ headers: { 'user-agent': 'jest' } });
    expect(logger.raw.join('')).not.toContain('zip-secret');
    expect(logger.raw.join('')).not.toContain('src-secret');
    expect(logger.raw.join('')).not.toContain('token-123');
    expect(logger.raw.join('')).not.toContain('session=abc');
  });

  it('skips the access log for the excluded endpoints only', async () => {
    const lines = await withServer(logger, async (server) => {
      const { port } = server.address() as AddressInfo;
      for (const path of ['/health', '/health/live', '/metrics', '/healthz']) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`);
        expect(response.status).toBe(200);
      }
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]['msg']).toBe('request completed');
  });

  it('emits exactly one access log line for a normal route', async () => {
    const lines = await withServer(logger, async (server) => {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/uploads`);
      expect(response.status).toBe(200);
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]['msg']).toBe('request completed');
    expect(lines[0]['service']).toBe('fiap-x-api');
  });

  it('defaults to the info level when LOG_LEVEL is unset', () => {
    const local = createCapturingLogger(context);

    local.instance.logger.debug('hidden debug');
    local.instance.logger.info('shown info');

    expect(local.parsed().map((line) => line['msg'])).toEqual(['shown info']);
  });

  it('honors LOG_LEVEL from the environment', () => {
    process.env.LOG_LEVEL = 'error';
    const local = createCapturingLogger(context);

    local.instance.logger.info('hidden info');
    local.instance.logger.error('shown error');

    expect(local.parsed().map((line) => line['msg'])).toEqual(['shown error']);
  });
});
