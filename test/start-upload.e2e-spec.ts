import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { InMemoryUploadStorage } from './../src/storage/in-memory-upload-storage';
import { UPLOAD_STORAGE } from './../src/storage/upload-storage.port';
import { StorageUnavailableError } from './../src/storage/storage-unavailable.error';
import { TestIdentityProvider } from './support/test-identity-provider';
import { TestStorageEnv } from './support/test-storage';
import { countCatalogCalls } from './support/catalog-calls';
import { CapturingLogger } from './support/capturing-logger';

const PART_SIZE = 16_777_216;
const MAX_SIZE = 524_288_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FILE_NAME_MESSAGE =
  'fileName must be at most 255 characters and end in .mp4 or .mov';
const CONTENT_TYPE_MESSAGE =
  'contentType must be video/mp4 for .mp4 or video/quicktime for .mov';
const SIZE_MESSAGE = 'sizeBytes must be an integer between 1 and 524288000';

interface StartBody {
  uploadId: string;
  partSize: number;
  parts: { partNumber: number; url: string }[];
  expiresAt: string;
}

describe('POST /uploads (e2e)', () => {
  const idp = new TestIdentityProvider();
  const storageEnv = new TestStorageEnv();
  let app: INestApplication<App>;
  let storage: InMemoryUploadStorage;
  let logger: CapturingLogger;
  let alice: string;

  beforeAll(async () => {
    await idp.start();
    storageEnv.set();
    alice = await idp.token({ sub: 'alice' });
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
    logger = new CapturingLogger();
    app.useLogger(logger);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await app.close();
  });

  const start = (body: object, token: string | null = alice) => {
    const req = request(app.getHttpServer()).post('/uploads');
    if (token !== null) {
      void req.set('Authorization', `Bearer ${token}`);
    }
    return req.send(body);
  };

  const video = (sizeBytes: number, fileName = 'clip.mp4') => ({
    fileName,
    contentType: fileName.toLowerCase().endsWith('.mov')
      ? 'video/quicktime'
      : 'video/mp4',
    sizeBytes,
  });

  /** Freezes only the wall clock, at the real current time, so tokens stay valid. */
  const freezeClock = (): number => {
    const now = Date.now();
    jest.useFakeTimers({
      now,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    return now;
  };

  it('answers 201 with uploadId, partSize, one presigned URL per part and expiresAt one hour ahead (AC P1.1-P1.3)', async () => {
    const now = freezeClock();

    const res = await start(video(20 * 1024 * 1024)).expect(201);

    const body = res.body as StartBody;
    expect(Object.keys(body).sort()).toEqual([
      'expiresAt',
      'partSize',
      'parts',
      'uploadId',
    ]);
    expect(body.uploadId).toMatch(UUID);
    expect(body.partSize).toBe(PART_SIZE);
    expect(body.expiresAt).toBe(new Date(now + 3600 * 1000).toISOString());

    const key = `sources/alice/${body.uploadId}.mp4`;
    const signed = storage.presigned.filter((record) => record.kind === 'part');
    expect(signed.map((record) => [record.key, record.partNumber])).toEqual([
      [key, 1],
      [key, 2],
    ]);
    expect(signed.every((record) => record.ttlSeconds === 3600)).toBe(true);
    expect(body.parts).toEqual(
      signed.map((record) => ({
        partNumber: record.partNumber,
        url: record.url,
      })),
    );
    expect(body.parts.every((part) => Object.keys(part).length === 2)).toBe(
      true,
    );
    await expect(
      storage.findInProgress(`sources/alice/${body.uploadId}.`),
    ).resolves.toEqual({ key, storageUploadId: signed[0].storageUploadId });
    // No field carries the key; the URLs, which necessarily name the
    // object, are the only place it appears.
    expect(Object.values(body)).not.toContain(key);
  });

  it.each<[string, number, number[]]>([
    ['1 byte', 1, [1]],
    ['exactly two parts', 2 * PART_SIZE, [1, 2]],
    ['one byte over two parts', 2 * PART_SIZE + 1, [1, 2, 3]],
    [
      'the 500 MiB maximum',
      MAX_SIZE,
      Array.from({ length: 32 }, (_, i) => i + 1),
    ],
  ])(
    'numbers the parts 1..ceil(size / partSize) for %s (AC P1.1, edge cases)',
    async (_, sizeBytes, partNumbers) => {
      const res = await start(video(sizeBytes)).expect(201);

      expect(
        (res.body as StartBody).parts.map((part) => part.partNumber),
      ).toEqual(partNumbers);
    },
  );

  it.each<[string, string]>([
    ['clip.MOV', 'mov'],
    ['Holiday.Mp4', 'mp4'],
  ])(
    'generates the key under the caller with the lowercase extension for %s (AC P1.2)',
    async (fileName, extension) => {
      const res = await start(video(1, fileName)).expect(201);

      const { uploadId } = res.body as StartBody;
      await expect(
        storage.findInProgress(`sources/alice/${uploadId}.`),
      ).resolves.toMatchObject({
        key: `sources/alice/${uploadId}.${extension}`,
      });
    },
  );

  it.each<[string, string, string, string]>([
    ['clip.mov', 'VIDEO/QuickTime', 'video/quicktime', 'mov'],
    ['clip.mp4', 'Video/MP4', 'video/mp4', 'mp4'],
  ])(
    'accepts %s with contentType %s and stores the object as %s (AC P3.1, P3.2)',
    async (fileName, contentType, stored, extension) => {
      const startSpy = jest.spyOn(storage, 'startMultipart');

      const res = await start({ fileName, contentType, sizeBytes: 1 }).expect(
        201,
      );

      const { uploadId } = res.body as StartBody;
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(startSpy).toHaveBeenCalledWith(
        `sources/alice/${uploadId}.${extension}`,
        stored,
        1,
      );
    },
  );

  it('accepts a fileName of exactly 255 characters', async () => {
    await start(video(1, `${'a'.repeat(251)}.mp4`)).expect(201);
  });

  it.each<[string, object, string]>([
    [
      'a .avi fileName',
      { fileName: 'clip.avi', contentType: 'video/mp4', sizeBytes: 1 },
      FILE_NAME_MESSAGE,
    ],
    [
      'a fileName without an extension',
      { fileName: 'clip', contentType: 'video/mp4', sizeBytes: 1 },
      FILE_NAME_MESSAGE,
    ],
    [
      'a fileName of 256 characters',
      {
        fileName: `${'a'.repeat(252)}.mp4`,
        contentType: 'video/mp4',
        sizeBytes: 1,
      },
      FILE_NAME_MESSAGE,
    ],
    [
      '.MP4 with video/quicktime',
      { fileName: 'clip.MP4', contentType: 'video/quicktime', sizeBytes: 1 },
      CONTENT_TYPE_MESSAGE,
    ],
    [
      '.mov with video/mp4',
      { fileName: 'clip.mov', contentType: 'video/mp4', sizeBytes: 1 },
      CONTENT_TYPE_MESSAGE,
    ],
    [
      '.mov with VIDEO/MP4 (AC P3.3)',
      { fileName: 'clip.mov', contentType: 'VIDEO/MP4', sizeBytes: 1 },
      CONTENT_TYPE_MESSAGE,
    ],
    [
      '.mp4 with parameters after the type (AC P3.3)',
      {
        fileName: 'clip.mp4',
        contentType: 'video/mp4; codecs=avc1',
        sizeBytes: 1,
      },
      CONTENT_TYPE_MESSAGE,
    ],
    [
      '.mp4 with a non-video type',
      { fileName: 'clip.mp4', contentType: 'image/png', sizeBytes: 1 },
      CONTENT_TYPE_MESSAGE,
    ],
    [
      'sizeBytes 0',
      { fileName: 'clip.mp4', contentType: 'video/mp4', sizeBytes: 0 },
      SIZE_MESSAGE,
    ],
    [
      'sizeBytes 524288001',
      {
        fileName: 'clip.mp4',
        contentType: 'video/mp4',
        sizeBytes: MAX_SIZE + 1,
      },
      SIZE_MESSAGE,
    ],
    [
      'a non-integer sizeBytes',
      { fileName: 'clip.mp4', contentType: 'video/mp4', sizeBytes: 1.5 },
      SIZE_MESSAGE,
    ],
    [
      'a sizeBytes sent as a string',
      { fileName: 'clip.mp4', contentType: 'video/mp4', sizeBytes: '10' },
      SIZE_MESSAGE,
    ],
  ])(
    'answers 400 naming the field for %s, without touching storage (AC P1.4-P1.6)',
    async (_, body, message) => {
      const storageCalls = countCatalogCalls(storage);

      const res = await start(body).expect(400);

      expect(res.body).toEqual({ statusCode: 400, message: [message] });
      expect(storageCalls()).toBe(0);
    },
  );

  it('answers 401 without a token and does not contact storage (AC P1.7)', async () => {
    const storageCalls = countCatalogCalls(storage);

    const res = await start(video(1), null).expect(401);

    expect(res.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    expect(storageCalls()).toBe(0);
  });

  it.each<['startMultipart' | 'presignPart']>([
    ['startMultipart'],
    ['presignPart'],
  ])('answers 502 when storage fails in %s (AC P1.8)', async (method) => {
    jest
      .spyOn(storage, method)
      .mockRejectedValue(new StorageUnavailableError());

    const res = await start(video(1)).expect(502);

    expect(res.body).toEqual({
      statusCode: 502,
      message: 'Storage unavailable',
    });
  });

  it('never logs a part URL or its signature, on success or on failure (edge case, UPL-10)', async () => {
    const ok = await start(video(2 * PART_SIZE)).expect(201);
    jest
      .spyOn(storage, 'presignPart')
      .mockRejectedValue(new StorageUnavailableError());
    await start(video(1)).expect(502);

    const logs = logger.text;
    // The capture works: Nest logged the route table at startup.
    expect(logs).toContain('Mapped {/uploads, POST} route');
    expect(logs).not.toContain('X-Amz-Signature');
    expect(logs).not.toContain('fake-signature');
    for (const part of (ok.body as StartBody).parts) {
      expect(logs).not.toContain(part.url);
    }
  });
});
