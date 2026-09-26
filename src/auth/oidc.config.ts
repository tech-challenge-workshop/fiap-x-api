export interface OidcConfig {
  issuer: string;
  audience: string;
  jwksUrl: string;
  jwksTimeoutMs: number;
}

const DEFAULT_JWKS_TIMEOUT_MS = 2000;

export function loadOidcConfig(env: NodeJS.ProcessEnv): OidcConfig {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) {
      throw new Error(`${name} is required`);
    }
    return value;
  };

  const issuer = required('OIDC_ISSUER');
  const audience = required('OIDC_AUDIENCE');
  const jwksUrl = required('OIDC_JWKS_URL');

  const rawTimeout = env.OIDC_JWKS_TIMEOUT_MS?.trim();
  const jwksTimeoutMs = rawTimeout
    ? Number(rawTimeout)
    : DEFAULT_JWKS_TIMEOUT_MS;
  if (!Number.isInteger(jwksTimeoutMs) || jwksTimeoutMs <= 0) {
    throw new Error('OIDC_JWKS_TIMEOUT_MS must be a positive integer');
  }

  return { issuer, audience, jwksUrl, jwksTimeoutMs };
}
