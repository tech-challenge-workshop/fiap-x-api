import { CatalogOwnedItem } from './ports/catalog-client.port';

/** What a user sees of one of their requests. */
export interface OwnedItem {
  processingRequestId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  failureReason?: string;
}

export interface OwnedPage {
  items: OwnedItem[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Copies an allow-list of fields, never deletes from the input, so a field
 * the Catalog adds later cannot reach a user by default (AUTH-09).
 */
export function projectForOwner(item: CatalogOwnedItem): OwnedItem {
  const owned: OwnedItem = {
    processingRequestId: item.processingRequestId,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
  if (item.status === 'FAILED' && item.failureReason !== undefined) {
    owned.failureReason = item.failureReason;
  }
  return owned;
}
