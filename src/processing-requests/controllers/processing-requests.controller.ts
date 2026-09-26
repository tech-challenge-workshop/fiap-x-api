import { Body, Controller, Get, Post, Query, UseFilters } from '@nestjs/common';
import { Owner } from '../../auth/owner.decorator';
import { CreateProcessingRequestService } from '../services/create-processing-request.service';
import { CreateProcessingRequestDto } from '../dtos/create-processing-request.dto';
import { CreateProcessingRequestResponseDto } from '../dtos/create-processing-request-response.dto';
import { CatalogErrorFilter } from '../filters/catalog-error.filter';
import { ListOwnProcessingRequestsService } from '../services/list-own-processing-requests.service';
import { ListQueryDto } from '../dtos/list-query.dto';
import { OwnedPage } from '../projection';

/** Every route acts for the authenticated owner, never for one named in the request. */
@Controller('processing-requests')
@UseFilters(CatalogErrorFilter)
export class ProcessingRequestsController {
  constructor(
    private readonly createService: CreateProcessingRequestService,
    private readonly listService: ListOwnProcessingRequestsService,
  ) {}

  @Post()
  create(
    @Owner() owner: string,
    @Body() dto: CreateProcessingRequestDto,
  ): Promise<CreateProcessingRequestResponseDto> {
    return this.createService.execute(owner, dto);
  }

  @Get()
  list(
    @Owner() owner: string,
    @Query() query: ListQueryDto,
  ): Promise<OwnedPage> {
    return this.listService.execute(owner, query.page, query.pageSize);
  }
}
