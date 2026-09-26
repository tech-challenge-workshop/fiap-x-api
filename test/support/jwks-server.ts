import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, JWK } from 'jose';

export interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

export async function createSigningKey(kid: string): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    extractable: true,
  });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256' };
  return { kid, privateKey, publicJwk };
}

type Mode =
  | { kind: 'serve' }
  | { kind: 'hang' }
  | { kind: 'status'; code: number }
  | { kind: 'body'; body: string };

/**
 * A real key-set endpoint over HTTP for tests. It can be stopped and started
 * again on the same port to simulate an identity-provider outage.
 */
export class JwksServer {
  private server?: Server;
  private port = 0;
  private keys: JWK[] = [];
  private mode: Mode = { kind: 'serve' };
  requestCount = 0;

  get url(): string {
    return `http://127.0.0.1:${this.port}/certs`;
  }

  serveKeys(...keys: SigningKey[]): void {
    this.keys = keys.map((key) => key.publicJwk);
    this.mode = { kind: 'serve' };
  }

  hang(): void {
    this.mode = { kind: 'hang' };
  }

  respondWithStatus(code: number): void {
    this.mode = { kind: 'status', code };
  }

  respondWithBody(body: string): void {
    this.mode = { kind: 'body', body };
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.requestCount += 1;
      const mode = this.mode;
      if (mode.kind === 'hang') {
        return;
      }
      if (mode.kind === 'status') {
        res.writeHead(mode.code).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        mode.kind === 'body' ? mode.body : JSON.stringify({ keys: this.keys }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(this.port, '127.0.0.1', resolve),
    );
    this.port = (server.address() as AddressInfo).port;
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }
    this.server = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
