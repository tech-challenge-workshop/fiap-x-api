import { randomUUID } from 'node:crypto';
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
      // SPEC_DEVIATION: a fresh key per call, so this route never replays.
      // Reason: transitional; the route and this service are removed in T9.
      const created = await this.catalogClient.createProcessingRequest(
        ownerUserId,
        dto.sourceStorageKey,
        randomUUID(),
      );
      if (created.outcome === 'conflict') {
        throw new HttpException('Catalog unavailable', HttpStatus.BAD_GATEWAY);
      }
      return {
        processingRequestId: created.processingRequestId,
        status: created.status,
      };
    } catch (error) {
      if (error instanceof CatalogUnavailableError) {
        throw new HttpException('Catalog unavailable', HttpStatus.BAD_GATEWAY);
      }
      throw error;
    }
  }
}
