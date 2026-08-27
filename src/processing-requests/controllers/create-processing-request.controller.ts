import { Controller, Post, Body, UseFilters } from '@nestjs/common';
import { CreateProcessingRequestService } from '../services/create-processing-request.service';
import { CreateProcessingRequestDto } from '../dtos/create-processing-request.dto';
import { CreateProcessingRequestResponseDto } from '../dtos/create-processing-request-response.dto';
import { CatalogErrorFilter } from '../filters/catalog-error.filter';

@Controller('processing-requests')
@UseFilters(CatalogErrorFilter)
export class CreateProcessingRequestController {
  constructor(private readonly service: CreateProcessingRequestService) {}

  @Post()
  async create(
    @Body() dto: CreateProcessingRequestDto,
  ): Promise<CreateProcessingRequestResponseDto> {
    return this.service.execute(dto);
  }
}
