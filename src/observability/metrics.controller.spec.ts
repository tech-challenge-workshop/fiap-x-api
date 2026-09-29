import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { MetricsController } from './metrics.controller';
import { apiMetrics } from './metrics';

describe('MetricsController', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    apiMetrics.resetMetrics();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('responds 200 with the prometheus text exposition content type', async () => {
    const response = await request(app.getHttpServer()).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/plain; version=0.0.4');
  });

  it('exposes all four metric families after traffic', async () => {
    apiMetrics.recordUpload('accepted');
    apiMetrics.recordUpload('rejected');
    apiMetrics.recordDownload('authorized');
    apiMetrics.recordDownload('denied');
    apiMetrics.recordHttpRequest('GET', '/metrics', '200', 0.01);

    const response = await request(app.getHttpServer()).get('/metrics');

    expect(response.status).toBe(200);
    for (const family of [
      'fiapx_uploads_total{outcome="accepted"} 1',
      'fiapx_uploads_total{outcome="rejected"} 1',
      'fiapx_downloads_total{outcome="authorized"} 1',
      'fiapx_downloads_total{outcome="denied"} 1',
      'fiapx_http_requests_total{method="GET",route="/metrics",status="200"} 1',
      'fiapx_http_request_duration_seconds_count{method="GET",route="/metrics",status="200"} 1',
    ]) {
      expect(response.text).toContain(family);
    }
  });

  it('opts the whole controller out of the global JwtAuthGuard', () => {
    const isPublic: unknown = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      MetricsController,
    );

    expect(isPublic).toBe(true);
  });
});
