import { Body, Controller, Post, UseFilters } from '@nestjs/common';
import { Owner } from '../../auth/owner.decorator';
import { CreateProcessingRequestService } from '../services/create-processing-request.service';
import { CreateProcessingRequestDto } from '../dtos/create-processing-request.dto';
import { CreateProcessingRequestResponseDto } from '../dtos/create-processing-request-response.dto';
import { CatalogErrorFilter } from '../filters/catalog-error.filter';

/** Every route acts for the authenticated owner, never for one named in the request. */
@Controller('processing-requests')
@UseFilters(CatalogErrorFilter)
export class ProcessingRequestsController {
  constructor(private readonly createService: CreateProcessingRequestService) {}

  @Post()
  create(
    @Owner() owner: string,
    @Body() dto: CreateProcessingRequestDto,
  ): Promise<CreateProcessingRequestResponseDto> {
    return this.createService.execute(owner, dto);
  }
}
