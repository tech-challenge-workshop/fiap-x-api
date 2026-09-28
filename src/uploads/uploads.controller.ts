import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Param,
  Post,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { Response } from 'express';
import { Owner } from '../auth/owner.decorator';
import { OwnerEmail } from '../auth/owner-email.decorator';
import { CatalogErrorFilter } from '../processing-requests/filters/catalog-error.filter';
import { StartUploadDto } from './start-upload.dto';
import { StartedUpload, StartUploadService } from './start-upload.service';
import { CompleteUploadService } from './complete-upload.service';

/** Every upload belongs to the authenticated owner. */
@Controller('uploads')
@UseFilters(CatalogErrorFilter)
export class UploadsController {
  constructor(
    private readonly startService: StartUploadService,
    private readonly completeService: CompleteUploadService,
  ) {}

  @Post()
  start(
    @Owner() owner: string,
    @Body() dto: StartUploadDto,
  ): Promise<StartedUpload> {
    return this.startService.execute(owner, dto);
  }

  /** 201 when this call created the request, 200 when it replayed it. */
  @Post(':uploadId/complete')
  async complete(
    @Owner() owner: string,
    @OwnerEmail() ownerEmail: string | undefined,
    @Param('uploadId') uploadId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ processingRequestId: string; status: string }> {
    const confirmed = await this.completeService.execute(
      owner,
      ownerEmail,
      uploadId,
      idempotencyKey,
    );
    res.status(
      confirmed.outcome === 'created' ? HttpStatus.CREATED : HttpStatus.OK,
    );
    return {
      processingRequestId: confirmed.processingRequestId,
      status: confirmed.status,
    };
  }
}
