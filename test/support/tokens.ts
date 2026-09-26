import { SignJWT } from 'jose';
import { SigningKey } from './jwks-server';

export const TEST_ISSUER = 'http://issuer.test/realms/fiapx';
export const TEST_AUDIENCE = 'fiapx-api';

/**
 * Signs a real RS256 token. Defaults to a valid token for `alice`; pass a
 * claim as `undefined` to leave it out.
 */
export async function signToken(
  key: SigningKey,
  claims: Record<string, unknown> = {},
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: TEST_ISSUER,
    aud: TEST_AUDIENCE,
    sub: 'alice',
    iat: nowSeconds,
    exp: nowSeconds + 300,
    ...claims,
  };
  for (const name of Object.keys(payload)) {
    if (payload[name] === undefined) {
      delete payload[name];
    }
  }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: key.kid })
    .sign(key.privateKey);
}

/** Flips one character of the payload segment, keeping the signature. */
export function tamperPayload(token: string): string {
  const [header, payload, signature] = token.split('.');
  const decoded = JSON.parse(
    Buffer.from(payload, 'base64url').toString(),
  ) as Record<string, unknown>;
  const forged = Buffer.from(
    JSON.stringify({ ...decoded, sub: 'mallory' }),
  ).toString('base64url');
  return [header, forged, signature].join('.');
}
