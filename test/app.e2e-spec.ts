import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { TestIdentityProvider } from './support/test-identity-provider';

describe('AppController (e2e)', () => {
  const idp = new TestIdentityProvider();
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    await idp.start();
    token = await idp.token();
  });

  afterAll(async () => {
    await idp.stop();
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });
});
