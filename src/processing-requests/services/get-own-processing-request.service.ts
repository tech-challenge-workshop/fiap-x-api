import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CatalogClient,
  CatalogOwnedItem,
} from '../ports/catalog-client.port';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';
import { CATALOG_CLIENT } from '../ports/catalog-client.port';
import { OwnedItem, projectForOwner } from '../projection';

@Injectable()
export class GetOwnProcessingRequestService {
  constructor(
    @Inject(CATALOG_CLIENT)
    private readonly catalogClient: CatalogClient,
  ) {}

  async execute(
    ownerUserId: string,
    processingRequestId: string,
  ): Promise<OwnedItem> {
    let item: CatalogOwnedItem | undefined;
    try {
      item = await this.catalogClient.getOwned(
        ownerUserId,
        processingRequestId,
      );
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw new HttpException('Catalog unavailable', HttpStatus.BAD_GATEWAY);
      }
      throw error;
    }
    if (!item) {
      // One body for another owner's id, an unknown id and a malformed id,
      // so the answer never reveals which requests exist.
      throw new NotFoundException('Processing request not found');
    }
    return projectForOwner(item);
  }
}
