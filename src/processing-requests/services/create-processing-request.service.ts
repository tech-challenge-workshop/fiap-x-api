import { Injectable, Inject } from '@nestjs/common';
import type { CatalogClient } from '../ports/catalog-client.port';
import { CreateProcessingRequestDto } from '../dtos/create-processing-request.dto';
import { CreateProcessingRequestResponseDto } from '../dtos/create-processing-request-response.dto';

export const CATALOG_CLIENT = Symbol('CATALOG_CLIENT');

@Injectable()
export class CreateProcessingRequestService {
  constructor(
    @Inject(CATALOG_CLIENT)
    private readonly catalogClient: CatalogClient,
  ) {}

  async execute(
    dto: CreateProcessingRequestDto,
  ): Promise<CreateProcessingRequestResponseDto> {
    const processingRequestId = await this.catalogClient.createProcessingRequest(
      dto.ownerUserId,
      dto.sourceStorageKey,
    );

    return { processingRequestId };
  }
}
