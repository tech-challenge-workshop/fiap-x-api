import { ConflictException, NotFoundException } from '@nestjs/common';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';
import type { CatalogClient } from '../ports/catalog-client.port';
import type { StorageConfig } from '../../storage/storage.config';
import type { UploadStorage } from '../../storage/upload-storage.port';
import { apiMetrics } from '../../observability/metrics';
import { DownloadService } from './download.service';

describe('DownloadService metrics', () => {
  const catalog = { getArchive: jest.fn() } as unknown as CatalogClient;
  const storage = { presignGet: jest.fn() } as unknown as UploadStorage;
  const config = {
    downloadUrlTtlSeconds: 60,
  } as unknown as StorageConfig;
  let service: DownloadService;

  beforeEach(() => {
    apiMetrics.resetMetrics();
    jest.resetAllMocks();
    service = new DownloadService(catalog, storage, config);
  });

  afterEach(() => {
    apiMetrics.resetMetrics();
  });

  it('counts authorized when a download URL is issued', async () => {
    catalog.getArchive = jest
      .fn()
      .mockResolvedValue({ zipStorageKey: 'zips/1.zip' });
    storage.presignGet = jest
      .fn()
      .mockResolvedValue('https://signed.example/1.zip');

    const issued = await service.execute('owner-1', 'request-1');

    expect(issued.url).toBe('https://signed.example/1.zip');
    const exposition = await apiMetrics.metrics();
    expect(exposition).toContain(
      'fiapx_downloads_total{outcome="authorized"} 1',
    );
    expect(exposition).not.toContain('outcome="denied"');
  });

  it('counts denied for a not-completed request and still rejects with 409', async () => {
    catalog.getArchive = jest.fn().mockResolvedValue('not-completed');

    const failure = service.execute('owner-1', 'request-1');

    await expect(failure).rejects.toBeInstanceOf(ConflictException);
    await expect(failure).rejects.toMatchObject({ status: 409 });
    const exposition = await apiMetrics.metrics();
    expect(exposition).toContain('fiapx_downloads_total{outcome="denied"} 1');
    expect(exposition).not.toContain('outcome="authorized"');
  });

  it('counts denied for a request another owner cannot see and still rejects with 404', async () => {
    catalog.getArchive = jest.fn().mockResolvedValue(undefined);

    const failure = service.execute('owner-2', 'request-1');

    await expect(failure).rejects.toBeInstanceOf(NotFoundException);
    await expect(failure).rejects.toMatchObject({ status: 404 });
    const exposition = await apiMetrics.metrics();
    expect(exposition).toContain('fiapx_downloads_total{outcome="denied"} 1');
  });

  it('counts nothing when the catalog is unavailable', async () => {
    catalog.getArchive = jest
      .fn()
      .mockRejectedValue(new CatalogUnavailableError('down'));

    const failure = service.execute('owner-1', 'request-1');

    await expect(failure).rejects.toMatchObject({ status: 502 });
    const exposition = await apiMetrics.metrics();
    expect(exposition).not.toContain('fiapx_downloads_total{outcome=');
  });
});
