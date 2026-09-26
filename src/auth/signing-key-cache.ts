import {
  createLocalJWKSet,
  errors,
  JSONWebKeySet,
  JWSHeaderParameters,
} from 'jose';
import { IdentityProviderUnavailableError } from './identity-provider-unavailable.error';

type LocalKeySet = ReturnType<typeof createLocalJWKSet>;

/**
 * Resolves a token's signing key from the provider's key set.
 *
 * Keys never expire: a key already fetched keeps verifying while the
 * provider is down. Only an unknown kid triggers a refetch, shared by
 * concurrent callers, so an outage (IdentityProviderUnavailableError) is
 * told apart from a key the provider does not have (JWKSNoMatchingKey).
 */
export class SigningKeyCache {
  private keySet?: LocalKeySet;
  private inFlight?: Promise<LocalKeySet>;

  constructor(
    private readonly jwksUrl: string,
    private readonly timeoutMs: number,
  ) {}

  keyFor = async (header: JWSHeaderParameters): Promise<CryptoKey> => {
    if (this.keySet) {
      try {
        return await this.keySet(header);
      } catch (error) {
        if (!(error instanceof errors.JWKSNoMatchingKey)) {
          throw error;
        }
      }
    }
    const refreshed = await this.refetch();
    return refreshed(header);
  };

  private refetch(): Promise<LocalKeySet> {
    this.inFlight ??= this.fetchKeySet().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async fetchKeySet(): Promise<LocalKeySet> {
    let keySet: LocalKeySet;
    try {
      const response = await fetch(this.jwksUrl, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`key set answered ${response.status}`);
      }
      keySet = createLocalJWKSet((await response.json()) as JSONWebKeySet);
    } catch {
      throw new IdentityProviderUnavailableError();
    }
    this.keySet = keySet;
    return keySet;
  }
}
