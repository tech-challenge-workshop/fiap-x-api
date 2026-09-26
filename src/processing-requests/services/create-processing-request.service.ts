import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import type { CatalogClient } from '../ports/catalog-client.port';
import { CreateProcessingRequestDto } from '../dtos/create-processing-request.dto';
import { CreateProcessingRequestResponseDto } from '../dtos/create-processing-request-response.dto';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';

export const CATALOG_CLIENT = Symbol('CATALOG_CLIENT');

@Injectable()
export class CreateProcessingRequestService {
  constructor(
    @Inject(CATALOG_CLIENT)
    private readonly catalogClient: CatalogClient,
  ) {}

  async execute(
    ownerUserId: string,
    dto: CreateProcessingRequestDto,
  ): Promise<CreateProcessingRequestResponseDto> {
    try {
      const { processingRequestId, status } =
        await this.catalogClient.createProcessingRequest(
          ownerUserId,
          dto.sourceStorageKey,
        );
      return { processingRequestId, status };
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw new HttpException('Catalog unavailable', HttpStatus.BAD_GATEWAY);
      }
      throw error;
    }
  }
}
