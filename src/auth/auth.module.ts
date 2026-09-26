import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { loadOidcConfig, OidcConfig } from './oidc.config';
import { SigningKeyCache } from './signing-key-cache';
import { TokenVerifier } from './token-verifier';
import { JwtAuthGuard } from './jwt-auth.guard';

export const OIDC_CONFIG = Symbol('OIDC_CONFIG');

@Module({
  providers: [
    {
      provide: OIDC_CONFIG,
      useFactory: (): OidcConfig => loadOidcConfig(process.env),
    },
    {
      provide: SigningKeyCache,
      inject: [OIDC_CONFIG],
      useFactory: (config: OidcConfig) =>
        new SigningKeyCache(config.jwksUrl, config.jwksTimeoutMs),
    },
    {
      provide: TokenVerifier,
      inject: [SigningKeyCache, OIDC_CONFIG],
      useFactory: (keys: SigningKeyCache, config: OidcConfig) =>
        new TokenVerifier(keys, {
          issuer: config.issuer,
          audience: config.audience,
        }),
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
