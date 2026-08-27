export interface CatalogClient {
  createProcessingRequest(
    ownerUserId: string,
    sourceStorageKey: string,
  ): Promise<string>;
}
