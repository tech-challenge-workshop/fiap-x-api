import { loadOidcConfig } from './oidc.config';

describe('loadOidcConfig', () => {
  const complete = {
    OIDC_ISSUER: 'http://localhost:8080/realms/fiapx',
    OIDC_AUDIENCE: 'fiapx-api',
    OIDC_JWKS_URL:
      'http://identity:8080/realms/fiapx/protocol/openid-connect/certs',
  };

  it('returns issuer, audience, key-set URL and a 2000 ms default timeout', () => {
    expect(loadOidcConfig({ ...complete })).toEqual({
      issuer: 'http://localhost:8080/realms/fiapx',
      audience: 'fiapx-api',
      jwksUrl:
        'http://identity:8080/realms/fiapx/protocol/openid-connect/certs',
      jwksTimeoutMs: 2000,
    });
  });

  it.each(['OIDC_ISSUER', 'OIDC_AUDIENCE', 'OIDC_JWKS_URL'])(
    'throws naming %s when it is missing',
    (name) => {
      const env: NodeJS.ProcessEnv = { ...complete };
      delete env[name];

      expect(() => loadOidcConfig(env)).toThrow(
        new Error(`${name} is required`),
      );
    },
  );

  it.each(['OIDC_ISSUER', 'OIDC_AUDIENCE', 'OIDC_JWKS_URL'])(
    'throws naming %s when it is blank',
    (name) => {
      const env: NodeJS.ProcessEnv = { ...complete, [name]: '   ' };

      expect(() => loadOidcConfig(env)).toThrow(
        new Error(`${name} is required`),
      );
    },
  );

  it('reads OIDC_JWKS_TIMEOUT_MS when set', () => {
    const config = loadOidcConfig({
      ...complete,
      OIDC_JWKS_TIMEOUT_MS: '5000',
    });

    expect(config.jwksTimeoutMs).toBe(5000);
  });

  it.each(['0', '-1', 'abc'])(
    'throws naming OIDC_JWKS_TIMEOUT_MS when it is %p',
    (value) => {
      expect(() =>
        loadOidcConfig({ ...complete, OIDC_JWKS_TIMEOUT_MS: value }),
      ).toThrow(new Error('OIDC_JWKS_TIMEOUT_MS must be a positive integer'));
    },
  );
});
