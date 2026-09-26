import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { UploadsController } from './uploads.controller';
import { StartUploadService } from './start-upload.service';
import { CompleteUploadService } from './complete-upload.service';
import { ProcessingRequestsModule } from '../processing-requests/processing-requests.module';

@Module({
  imports: [StorageModule, ProcessingRequestsModule],
  controllers: [UploadsController],
  providers: [StartUploadService, CompleteUploadService],
})
export class UploadsModule {}
