import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { UploadsController } from './uploads.controller';
import { StartUploadService } from './start-upload.service';

@Module({
  imports: [StorageModule],
  controllers: [UploadsController],
  providers: [StartUploadService],
})
export class UploadsModule {}
