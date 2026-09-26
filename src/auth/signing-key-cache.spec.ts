import { errors, exportJWK } from 'jose';
import {
  createSigningKey,
  JwksServer,
  SigningKey,
} from '../../test/support/jwks-server';
import { SigningKeyCache } from './signing-key-cache';
import { IdentityProviderUnavailableError } from './identity-provider-unavailable.error';

describe('SigningKeyCache', () => {
  let server: JwksServer;
  let keyA: SigningKey;
  let keyB: SigningKey;

  const header = (kid: string) => ({ alg: 'RS256', kid });
  const modulusOf = async (key: CryptoKey) => (await exportJWK(key)).n;

  beforeAll(async () => {
    keyA = await createSigningKey('key-a');
    keyB = await createSigningKey('key-b');
  });

  beforeEach(async () => {
    server = new JwksServer();
    server.serveKeys(keyA);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  const newCache = (timeoutMs = 2000) =>
    new SigningKeyCache(server.url, timeoutMs);

  it('fetches the key set on first use and resolves the key for the kid', async () => {
    const cache = newCache();

    const key = await cache.keyFor(header('key-a'));

    expect(await modulusOf(key)).toBe(keyA.publicJwk.n);
    expect(server.requestCount).toBe(1);
  });

  it('keeps resolving a cached kid while the provider is down (AC P1.8)', async () => {
    const cache = newCache();
    await cache.keyFor(header('key-a'));
    await server.stop();

    const key = await cache.keyFor(header('key-a'));

    expect(await modulusOf(key)).toBe(keyA.publicJwk.n);
    expect(server.requestCount).toBe(1);
  });

  it('keeps resolving a cached kid 400 days later while the provider is down, because cached keys never expire (AC P1.8)', async () => {
    // Fake every clock source before the first fetch, so an expiry measured
    // with Date.now, performance.now or a timer is caught; leave the
    // microtask and I/O hooks real so the key-set server still answers.
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    try {
      const cache = newCache();
      await cache.keyFor(header('key-a'));
      await server.stop();

      jest.advanceTimersByTime(400 * 24 * 60 * 60 * 1000);
      const key = await cache.keyFor(header('key-a'));

      expect(await modulusOf(key)).toBe(keyA.publicJwk.n);
      expect(server.requestCount).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('throws IdentityProviderUnavailableError for an unknown kid while the provider is down (AC P1.7)', async () => {
    const cache = newCache();
    await cache.keyFor(header('key-a'));
    await server.stop();

    await expect(cache.keyFor(header('key-b'))).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError,
    );
  });

  it('throws IdentityProviderUnavailableError when nothing is cached and the provider is down (AC P1.7)', async () => {
    const cache = newCache();
    await server.stop();

    await expect(cache.keyFor(header('key-a'))).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError,
    );
  });

  it('resolves the new kid once the provider is back after an outage', async () => {
    const cache = newCache();
    await cache.keyFor(header('key-a'));
    await server.stop();
    await expect(cache.keyFor(header('key-b'))).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError,
    );

    server.serveKeys(keyA, keyB);
    await server.start();
    const key = await cache.keyFor(header('key-b'));

    expect(await modulusOf(key)).toBe(keyB.publicJwk.n);
  });

  it('refetches once and throws JWKSNoMatchingKey when the kid is still absent', async () => {
    const cache = newCache();
    await cache.keyFor(header('key-a'));

    await expect(cache.keyFor(header('key-b'))).rejects.toBeInstanceOf(
      errors.JWKSNoMatchingKey,
    );
    expect(server.requestCount).toBe(2);
  });

  it('picks up a rotated key after one refetch and drops the rotated-out one', async () => {
    const cache = newCache();
    await cache.keyFor(header('key-a'));
    server.serveKeys(keyB);

    const key = await cache.keyFor(header('key-b'));

    expect(await modulusOf(key)).toBe(keyB.publicJwk.n);
    expect(server.requestCount).toBe(2);
    await expect(cache.keyFor(header('key-a'))).rejects.toBeInstanceOf(
      errors.JWKSNoMatchingKey,
    );
    expect(server.requestCount).toBe(3);
  });

  it('shares one refetch between two concurrent misses', async () => {
    const cache = newCache();
    await cache.keyFor(header('key-a'));
    server.serveKeys(keyA, keyB);

    const [first, second] = await Promise.all([
      cache.keyFor(header('key-b')),
      cache.keyFor(header('key-b')),
    ]);

    expect(await modulusOf(first)).toBe(keyB.publicJwk.n);
    expect(await modulusOf(second)).toBe(keyB.publicJwk.n);
    expect(server.requestCount).toBe(2);
  });

  it('throws IdentityProviderUnavailableError when the provider hangs past the timeout', async () => {
    const cache = newCache(100);
    server.hang();

    await expect(cache.keyFor(header('key-a'))).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError,
    );
  });

  it('throws IdentityProviderUnavailableError when the provider answers with an error status', async () => {
    const cache = newCache();
    server.respondWithStatus(500);

    await expect(cache.keyFor(header('key-a'))).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError,
    );
  });

  it('throws IdentityProviderUnavailableError when the provider answers with something other than a key set', async () => {
    const cache = newCache();
    server.respondWithBody('<html>maintenance</html>');

    await expect(cache.keyFor(header('key-a'))).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError,
    );
  });
});
