/** An item of the Catalog's owner-scoped reads, re-declared locally (AD-003). */
export interface CatalogOwnedItem {
  processingRequestId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  failureReason?: string;
}

export interface CatalogOwnedPage {
  items: CatalogOwnedItem[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * What the Catalog did with an idempotent create: `created` (201), `replayed`
 * (200, the owner's key already names this source) or `conflict` (409, the
 * key is bound to another source).
 */
export type CatalogCreateOutcome =
  | {
      outcome: 'created' | 'replayed';
      processingRequestId: string;
      status: string;
    }
  | { outcome: 'conflict' };

/**
 * The archive of the owner's request: its key when `COMPLETED`,
 * `'not-completed'` otherwise, `undefined` when the Catalog answers 404.
 */
export type CatalogArchive = { zipStorageKey: string } | 'not-completed';

export interface CatalogClient {
  createProcessingRequest(
    ownerUserId: string,
    sourceStorageKey: string,
    idempotencyKey: string,
  ): Promise<CatalogCreateOutcome>;

  getArchive(
    ownerUserId: string,
    processingRequestId: string,
  ): Promise<CatalogArchive | undefined>;

  /** The owner's requests, newest first. */
  listOwned(
    ownerUserId: string,
    page: number,
    pageSize: number,
  ): Promise<CatalogOwnedPage>;

  /** The owner's request, or `undefined` when the Catalog answers 404. */
  getOwned(
    ownerUserId: string,
    processingRequestId: string,
  ): Promise<CatalogOwnedItem | undefined>;
}
