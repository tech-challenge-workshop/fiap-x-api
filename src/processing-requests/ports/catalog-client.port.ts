export interface CatalogClient {
  createProcessingRequest(
    ownerUserId: string,
    sourceStorageKey: string,
  ): Promise<{ processingRequestId: string; status: string }>;
}
