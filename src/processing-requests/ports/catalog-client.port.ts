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

export interface CatalogClient {
  createProcessingRequest(
    ownerUserId: string,
    sourceStorageKey: string,
  ): Promise<{ processingRequestId: string; status: string }>;

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
