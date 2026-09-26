import { NestFactory } from '@nestjs/core';
import { ApplicationConfig } from '@nestjs/core/application-config';
import { INestApplication } from '@nestjs/common';
import { AppModule } from './../src/app.module';
import { JwtAuthGuard } from './../src/auth/jwt-auth.guard';
import { TestIdentityProvider } from './support/test-identity-provider';

describe('Authentication composition (e2e)', () => {
  const idp = new TestIdentityProvider();

  beforeEach(async () => {
    await idp.start();
  });

  afterEach(async () => {
    await idp.stop();
  });

  it.each(['OIDC_ISSUER', 'OIDC_AUDIENCE', 'OIDC_JWKS_URL'])(
    'refuses to boot when %s is missing',
    async (name) => {
      delete process.env[name];

      await expect(
        NestFactory.create(AppModule, { abortOnError: false, logger: false }),
      ).rejects.toThrow(new Error(`${name} is required`));
    },
  );

  it('registers JwtAuthGuard as the global APP_GUARD', async () => {
    const app: INestApplication = await NestFactory.create(AppModule, {
      abortOnError: false,
      logger: false,
    });
    try {
      await app.init();
      const config = (app as unknown as { config: ApplicationConfig }).config;

      const globalGuards = config
        .getGlobalGuards()
        .map((guard) => guard.constructor);

      expect(globalGuards).toEqual([JwtAuthGuard]);
    } finally {
      await app.close();
    }
  });
});
