import { errors, jwtVerify } from 'jose';
import { SigningKeyCache } from './signing-key-cache';

export interface TokenVerifierOptions {
  issuer: string;
  audience: string;
}

/**
 * Verifies a compact JWT and returns its `sub` and nothing else, so no other
 * claim can reach an authorization decision (AC P1.9). `exp`, `iss` and
 * `aud` are enforced by `jwtVerify`.
 */
export class TokenVerifier {
  constructor(
    private readonly keys: SigningKeyCache,
    private readonly options: TokenVerifierOptions,
  ) {}

  async verify(token: string): Promise<{ sub: string }> {
    const { payload } = await jwtVerify(token, this.keys.keyFor, {
      issuer: this.options.issuer,
      audience: this.options.audience,
      algorithms: ['RS256'],
      requiredClaims: ['sub'],
    });
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new errors.JWTClaimValidationFailed(
        '"sub" claim must be a non-empty string',
        payload,
        'sub',
        'check_failed',
      );
    }
    return { sub: payload.sub };
  }
}
