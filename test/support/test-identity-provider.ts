import { createSigningKey, JwksServer, SigningKey } from './jwks-server';
import { signToken, TEST_AUDIENCE, TEST_ISSUER } from './tokens';

const OIDC_VARIABLES = [
  'OIDC_ISSUER',
  'OIDC_AUDIENCE',
  'OIDC_JWKS_URL',
  'OIDC_JWKS_TIMEOUT_MS',
] as const;

/**
 * A local identity provider for e2e suites: a real key-set server, the OIDC
 * environment `AppModule` requires, and real RS256 tokens. Start it before
 * compiling `AppModule`; stop it after the suite to restore the environment.
 */
export class TestIdentityProvider {
  readonly server = new JwksServer();
  key!: SigningKey;
  private savedEnv: Partial<Record<string, string>> = {};

  async start(): Promise<void> {
    this.key = await createSigningKey('test-key-1');
    this.server.serveKeys(this.key);
    await this.server.start();
    for (const name of OIDC_VARIABLES) {
      this.savedEnv[name] = process.env[name];
    }
    process.env.OIDC_ISSUER = TEST_ISSUER;
    process.env.OIDC_AUDIENCE = TEST_AUDIENCE;
    process.env.OIDC_JWKS_URL = this.server.url;
    delete process.env.OIDC_JWKS_TIMEOUT_MS;
  }

  token(claims: Record<string, unknown> = {}): Promise<string> {
    return signToken(this.key, claims);
  }

  async stop(): Promise<void> {
    await this.server.stop();
    for (const name of OIDC_VARIABLES) {
      const value = this.savedEnv[name];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}
