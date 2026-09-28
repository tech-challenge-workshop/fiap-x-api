import { register } from 'prom-client';
import { ApiMetrics } from './metrics';

describe('ApiMetrics', () => {
  let metrics: ApiMetrics;

  beforeEach(() => {
    metrics = new ApiMetrics();
  });

  it('increments only the accepted upload outcome', async () => {
    metrics.recordUpload('accepted');

    const exposition = await metrics.metrics();
    expect(exposition).toContain(
      'fiapx_uploads_total{outcome="accepted"} 1',
    );
    expect(exposition).not.toContain('outcome="rejected"');
  });

  it('increments only the rejected upload outcome', async () => {
    metrics.recordUpload('rejected');
    metrics.recordUpload('rejected');

    const exposition = await metrics.metrics();
    expect(exposition).toContain(
      'fiapx_uploads_total{outcome="rejected"} 2',
    );
    expect(exposition).not.toContain('outcome="accepted"');
  });

  it('increments only the authorized download outcome', async () => {
    metrics.recordDownload('authorized');

    const exposition = await metrics.metrics();
    expect(exposition).toContain(
      'fiapx_downloads_total{outcome="authorized"} 1',
    );
    expect(exposition).not.toContain('outcome="denied"');
  });

  it('increments only the denied download outcome', async () => {
    metrics.recordDownload('denied');

    const exposition = await metrics.metrics();
    expect(exposition).toContain('fiapx_downloads_total{outcome="denied"} 1');
    expect(exposition).not.toContain('outcome="authorized"');
  });

  it('records one http count and duration series per request', async () => {
    metrics.recordHttpRequest('GET', '/uploads', '200', 0.25);

    const exposition = await metrics.metrics();
    expect(exposition).toContain(
      'fiapx_http_requests_total{method="GET",route="/uploads",status="200"} 1',
    );
    expect(exposition).toContain(
      'fiapx_http_request_duration_seconds_count{method="GET",route="/uploads",status="200"} 1',
    );
    expect(await register.metrics()).not.toContain('fiapx_');
  });

  it('resets every metric to zero without re-registering duplicates', async () => {
    metrics.recordUpload('accepted');
    metrics.recordHttpRequest('POST', '/uploads', '201', 0.5);

    metrics.resetMetrics();
    const empty = await metrics.metrics();
    expect(empty).not.toContain('outcome=');
    expect(empty).not.toContain('{method=');

    metrics.recordUpload('accepted');
    metrics.recordHttpRequest('POST', '/uploads', '201', 0.5);
    const exposition = await metrics.metrics();
    expect(exposition).toContain(
      'fiapx_uploads_total{outcome="accepted"} 1',
    );
    expect(exposition).toContain(
      'fiapx_http_requests_total{method="POST",route="/uploads",status="201"} 1',
    );
  });
});
