import { errors, jwtVerify } from 'jose';
import { SigningKeyCache } from './signing-key-cache';

export interface TokenVerifierOptions {
  issuer: string;
  audience: string;
}

/**
 * Verifies a compact JWT and returns its `sub` and, when present, its
 * standard `email` claim. Nothing else is read. `email` never enters any
 * authorization decision (AC P1.9 still holds for `sub`) — it exists only
 * so the caller can pass it on for notification purposes.
 */
export class TokenVerifier {
  constructor(
    private readonly keys: SigningKeyCache,
    private readonly options: TokenVerifierOptions,
  ) {}

  async verify(token: string): Promise<{ sub: string; email?: string }> {
    const { payload } = await jwtVerify(token, this.keys.keyFor, {
      issuer: this.options.issuer,
      audience: this.options.audience,
      algorithms: ['RS256'],
      // Without `exp` a leaked token would never expire.
      requiredClaims: ['exp', 'sub'],
    });
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new errors.JWTClaimValidationFailed(
        '"sub" claim must be a non-empty string',
        payload,
        'sub',
        'check_failed',
      );
    }
    return typeof payload.email === 'string' && payload.email !== ''
      ? { sub: payload.sub, email: payload.email }
      : { sub: payload.sub };
  }
}
