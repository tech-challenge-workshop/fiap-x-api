import { projectForOwner } from './projection';
import { CatalogOwnedItem } from './ports/catalog-client.port';

describe('projectForOwner', () => {
  const base = {
    processingRequestId: 'pr-1',
    createdAt: '2026-09-26T10:00:00.000Z',
    updatedAt: '2026-09-26T10:05:00.000Z',
  };

  /** A Catalog item leaking every internal field, plus one nobody knows yet. */
  const leaky = (status: string) =>
    ({
      ...base,
      status,
      failureReason: 'The video could not be processed',
      sourceStorageKey: 'sources/alice/clip.mp4',
      zipStorageKey: 'zips/alice/pr-1.zip',
      failureCode: 'FFMPEG_EXIT_1',
      attemptId: 'attempt-7',
      ownerUserId: 'alice',
      someFutureField: 'must not leak',
    }) as CatalogOwnedItem;

  it('keeps only the allow-listed fields, failureReason included, for FAILED', () => {
    expect(projectForOwner(leaky('FAILED'))).toStrictEqual({
      ...base,
      status: 'FAILED',
      failureReason: 'The video could not be processed',
    });
  });

  it.each(['RECEIVED', 'QUEUED', 'PROCESSING', 'COMPLETED'])(
    'drops failureReason and every internal field for %s',
    (status) => {
      const projected = projectForOwner(leaky(status));

      expect(projected).toStrictEqual({ ...base, status });
      expect(Object.keys(projected).sort()).toEqual([
        'createdAt',
        'processingRequestId',
        'status',
        'updatedAt',
      ]);
    },
  );
});
