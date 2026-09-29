import { Counter, Histogram, Registry } from 'prom-client';

const HTTP_LABELS = ['method', 'route', 'status'] as const;

/**
 * The API's Prometheus metrics on a dedicated registry, never the prom-client
 * global, so per-app state holds and e2e suites stay isolated. Call sites use
 * the one process-wide instance; unit tests build their own.
 */
export class ApiMetrics {
  private readonly registry = new Registry();

  private readonly uploadsTotal = new Counter({
    name: 'fiapx_uploads_total',
    help: 'Uploads started at the edge, by outcome.',
    labelNames: ['outcome'],
    registers: [this.registry],
  });

  private readonly downloadsTotal = new Counter({
    name: 'fiapx_downloads_total',
    help: 'Download URL authorizations at the edge, by outcome.',
    labelNames: ['outcome'],
    registers: [this.registry],
  });

  private readonly httpRequestsTotal = new Counter({
    name: 'fiapx_http_requests_total',
    help: 'HTTP requests served, by method, route template, and status.',
    labelNames: [...HTTP_LABELS],
    registers: [this.registry],
  });

  private readonly httpRequestDuration = new Histogram({
    name: 'fiapx_http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method, route template, and status.',
    labelNames: [...HTTP_LABELS],
    registers: [this.registry],
  });

  recordUpload(outcome: 'accepted' | 'rejected'): void {
    this.uploadsTotal.inc({ outcome });
  }

  recordDownload(outcome: 'authorized' | 'denied'): void {
    this.downloadsTotal.inc({ outcome });
  }

  recordHttpRequest(
    method: string,
    route: string,
    status: string,
    durationSeconds: number,
  ): void {
    const labels = { method, route, status };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, durationSeconds);
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  resetMetrics(): void {
    this.registry.resetMetrics();
  }
}

export const apiMetrics = new ApiMetrics();
