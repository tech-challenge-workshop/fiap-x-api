import { Controller, Get, Param, Query, UseFilters } from '@nestjs/common';
import { Owner } from '../../auth/owner.decorator';
import { CatalogErrorFilter } from '../filters/catalog-error.filter';
import { ListOwnProcessingRequestsService } from '../services/list-own-processing-requests.service';
import { ListQueryDto } from '../dtos/list-query.dto';
import { GetOwnProcessingRequestService } from '../services/get-own-processing-request.service';
import { OwnedItem, OwnedPage } from '../projection';

/**
 * Every route acts for the authenticated owner, never for one named in the
 * request. Requests are created only by confirming an upload
 * (`POST /uploads/:uploadId/complete`), never from a client's storage key.
 */
@Controller('processing-requests')
@UseFilters(CatalogErrorFilter)
export class ProcessingRequestsController {
  constructor(
    private readonly listService: ListOwnProcessingRequestsService,
    private readonly getService: GetOwnProcessingRequestService,
  ) {}

  @Get()
  list(
    @Owner() owner: string,
    @Query() query: ListQueryDto,
  ): Promise<OwnedPage> {
    return this.listService.execute(owner, query.page, query.pageSize);
  }

  @Get(':id')
  get(@Owner() owner: string, @Param('id') id: string): Promise<OwnedItem> {
    return this.getService.execute(owner, id);
  }
}
