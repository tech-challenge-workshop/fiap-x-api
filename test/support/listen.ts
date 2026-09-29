import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'node:net';
import { App } from 'supertest/types';

/**
 * Binds the app to an ephemeral port on 127.0.0.1 — never the wildcard
 * address — so the S8 suites sidestep the intermittent listen(0) behavior
 * tracked as V40 (spec G owns fixing the twelve pre-existing suites).
 */
export async function listenOnLoopback(
  app: INestApplication<App>,
): Promise<string> {
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer() as unknown as {
    address(): AddressInfo;
  };
  return `http://127.0.0.1:${server.address().port}`;
}
