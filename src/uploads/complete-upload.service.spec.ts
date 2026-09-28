import { ConflictException } from '@nestjs/common';
import { InMemoryCatalogClient } from '../processing-requests/adapters/in-memory-catalog-client.adapter';
import type { UploadStorage } from '../storage/upload-storage.port';
import { correlationContext } from '../observability/correlation-context';
import { apiMetrics } from '../observability/metrics';
import { CompleteUploadService } from './complete-upload.service';

const UPLOAD_ID = '8c7d1eae-1234-4abc-8def-0123456789ab';
const OWNER = 'owner-1';

describe('CompleteUploadService correlation and metrics', () => {
  let findInProgress: jest.Mock;
  let findObject: jest.Mock;
  let catalog: InMemoryCatalogClient;
  let service: CompleteUploadService;
  let createSpy: jest.SpyInstance;

  const storageYields = (extension: string): void => {
    findInProgress.mockResolvedValue(undefined);
    findObject.mockResolvedValue({
      key: `sources/${OWNER}/${UPLOAD_ID}.${extension}`,
      sizeBytes: 10,
      declaredSizeBytes: 10,
    });
  };

  beforeEach(() => {
    apiMetrics.resetMetrics();
    findInProgress = jest.fn();
    findObject = jest.fn();
    const storage = {
      findInProgress,
      findObject,
    } as unknown as UploadStorage;
    catalog = new InMemoryCatalogClient();
    createSpy = jest.spyOn(catalog, 'createProcessingRequest');
    service = new CompleteUploadService(storage, catalog);
    storageYields('mp4');
  });

  afterEach(() => {
    createSpy.mockRestore();
    apiMetrics.resetMetrics();
  });

  it('passes the scoped correlation id and counts the accepted upload', async () => {
    const result = await correlationContext.runWithCorrelation(
      'corr-confirm',
      () => service.execute(OWNER, `${OWNER}@fiapx.local`, UPLOAD_ID, 'idem-1'),
    );

    expect(result.outcome).toBe('created');
    expect(createSpy).toHaveBeenCalledWith(
      OWNER,
      `${OWNER}@fiapx.local`,
      `sources/${OWNER}/${UPLOAD_ID}.mp4`,
      'idem-1',
      'corr-confirm',
    );
    const exposition = await apiMetrics.metrics();
    expect(exposition).toContain('fiapx_uploads_total{outcome="accepted"} 1');
  });

  it('passes no correlation id outside a request scope', async () => {
    await service.execute(OWNER, `${OWNER}@fiapx.local`, UPLOAD_ID, 'idem-1');

    expect(createSpy).toHaveBeenCalledWith(
      OWNER,
      `${OWNER}@fiapx.local`,
      `sources/${OWNER}/${UPLOAD_ID}.mp4`,
      'idem-1',
      undefined,
    );
  });

  it('does not double-count an idempotent replay', async () => {
    const first = await correlationContext.runWithCorrelation(
      'corr-replay',
      () => service.execute(OWNER, `${OWNER}@fiapx.local`, UPLOAD_ID, 'idem-1'),
    );
    const second = await service.execute(
      OWNER,
      `${OWNER}@fiapx.local`,
      UPLOAD_ID,
      'idem-1',
    );

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('replayed');
    expect(second.processingRequestId).toBe(first.processingRequestId);
    const exposition = await apiMetrics.metrics();
    expect(exposition).toContain('fiapx_uploads_total{outcome="accepted"} 1');
  });

  it('does not count a conflicted confirmation as accepted', async () => {
    await service.execute(OWNER, `${OWNER}@fiapx.local`, UPLOAD_ID, 'idem-1');
    storageYields('mov');

    const failure = service.execute(
      OWNER,
      `${OWNER}@fiapx.local`,
      UPLOAD_ID,
      'idem-1',
    );

    await expect(failure).rejects.toBeInstanceOf(ConflictException);
    await expect(failure).rejects.toMatchObject({ status: 409 });
    const exposition = await apiMetrics.metrics();
    expect(exposition).toContain('fiapx_uploads_total{outcome="accepted"} 1');
    expect(exposition).not.toContain('outcome="accepted"} 2');
  });
});
