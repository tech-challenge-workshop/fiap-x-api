import { errors, SignJWT, UnsecuredJWT } from 'jose';
import {
  createSigningKey,
  JwksServer,
  SigningKey,
} from '../../test/support/jwks-server';
import {
  signToken,
  tamperPayload,
  TEST_AUDIENCE,
  TEST_ISSUER,
} from '../../test/support/tokens';
import { SigningKeyCache } from './signing-key-cache';
import { TokenVerifier } from './token-verifier';
import { IdentityProviderUnavailableError } from './identity-provider-unavailable.error';

describe('TokenVerifier', () => {
  let server: JwksServer;
  let key: SigningKey;
  let verifier: TokenVerifier;

  beforeAll(async () => {
    key = await createSigningKey('key-a');
  });

  beforeEach(async () => {
    server = new JwksServer();
    server.serveKeys(key);
    await server.start();
    verifier = new TokenVerifier(new SigningKeyCache(server.url, 2000), {
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
    });
  });

  afterEach(async () => {
    await server.stop();
  });

  const claimFailure = async (token: string) => {
    const error: unknown = await verifier.verify(token).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(errors.JWTClaimValidationFailed);
    return (error as InstanceType<typeof errors.JWTClaimValidationFailed>)
      .claim;
  };

  it('returns only the sub of a valid token, whatever else it carries', async () => {
    const token = await signToken(key, {
      email: 'alice@example.com',
      preferred_username: 'alice',
      realm_access: { roles: ['admin'] },
    });

    await expect(verifier.verify(token)).resolves.toStrictEqual({
      sub: 'alice',
    });
  });

  it('accepts an aud array that includes the configured audience', async () => {
    const token = await signToken(key, { aud: ['account', TEST_AUDIENCE] });

    await expect(verifier.verify(token)).resolves.toStrictEqual({
      sub: 'alice',
    });
  });

  it('rejects an expired token with JWTExpired (AC P1.3)', async () => {
    const token = await signToken(key, {
      exp: Math.floor(Date.now() / 1000) - 1,
    });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      errors.JWTExpired,
    );
  });

  it('rejects a token from another issuer (AC P1.4)', async () => {
    const token = await signToken(key, { iss: 'http://evil.test/realms/x' });

    expect(await claimFailure(token)).toBe('iss');
  });

  it('rejects a token for another audience (AC P1.5)', async () => {
    const token = await signToken(key, { aud: 'another-client' });

    expect(await claimFailure(token)).toBe('aud');
  });

  it('rejects a tampered payload with JWSSignatureVerificationFailed (AC P1.2)', async () => {
    const token = tamperPayload(await signToken(key));

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      errors.JWSSignatureVerificationFailed,
    );
  });

  it('rejects a token signed with HS256 with JOSEAlgNotAllowed', async () => {
    const token = await new SignJWT({
      iss: TEST_ISSUER,
      aud: TEST_AUDIENCE,
      sub: 'alice',
    })
      .setProtectedHeader({ alg: 'HS256', kid: key.kid })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('0123456789abcdef0123456789abcdef'));

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      errors.JOSEAlgNotAllowed,
    );
  });

  it('rejects an unsecured token (alg none) with JOSEAlgNotAllowed', async () => {
    const token = new UnsecuredJWT({
      iss: TEST_ISSUER,
      aud: TEST_AUDIENCE,
      sub: 'alice',
    })
      .setExpirationTime('5m')
      .encode();

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      errors.JOSEAlgNotAllowed,
    );
  });

  it('rejects a token without sub (AC P1.6)', async () => {
    const token = await signToken(key, { sub: undefined });

    expect(await claimFailure(token)).toBe('sub');
  });

  it.each([42, '', { id: 'alice' }])(
    'rejects a token whose sub is not a non-empty string (%p)',
    async (sub) => {
      const token = await signToken(key, { sub });

      expect(await claimFailure(token)).toBe('sub');
    },
  );

  it('rejects a malformed token with JWSInvalid', async () => {
    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(
      errors.JWSInvalid,
    );
  });

  it('propagates IdentityProviderUnavailableError when the key cannot be fetched (AC P1.7)', async () => {
    await server.stop();

    await expect(verifier.verify(await signToken(key))).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError,
    );
  });
});
