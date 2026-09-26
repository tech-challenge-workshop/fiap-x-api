import { Body, Controller, Post, UseFilters } from '@nestjs/common';
import { Owner } from '../auth/owner.decorator';
import { CatalogErrorFilter } from '../processing-requests/filters/catalog-error.filter';
import { StartUploadDto } from './start-upload.dto';
import { StartedUpload, StartUploadService } from './start-upload.service';

/** Every upload belongs to the authenticated owner. */
@Controller('uploads')
@UseFilters(CatalogErrorFilter)
export class UploadsController {
  constructor(private readonly startService: StartUploadService) {}

  @Post()
  start(
    @Owner() owner: string,
    @Body() dto: StartUploadDto,
  ): Promise<StartedUpload> {
    return this.startService.execute(owner, dto);
  }
}
