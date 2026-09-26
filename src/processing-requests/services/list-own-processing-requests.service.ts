import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CatalogClient } from '../ports/catalog-client.port';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';
import { CATALOG_CLIENT } from '../ports/catalog-client.port';
import { OwnedPage, projectForOwner } from '../projection';

@Injectable()
export class ListOwnProcessingRequestsService {
  constructor(
    @Inject(CATALOG_CLIENT)
    private readonly catalogClient: CatalogClient,
  ) {}

  async execute(
    ownerUserId: string,
    page: number,
    pageSize: number,
  ): Promise<OwnedPage> {
    try {
      const owned = await this.catalogClient.listOwned(
        ownerUserId,
        page,
        pageSize,
      );
      return {
        items: owned.items.map(projectForOwner),
        page: owned.page,
        pageSize: owned.pageSize,
        total: owned.total,
      };
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw new HttpException('Catalog unavailable', HttpStatus.BAD_GATEWAY);
      }
      throw error;
    }
  }
}
