import { Module } from '@nestjs/common';
import { CreateProcessingRequestController } from './controllers/create-processing-request.controller';
import { CreateProcessingRequestService } from './services/create-processing-request.service';
import { InMemoryCatalogClient } from './adapters/in-memory-catalog-client.adapter';
import { CATALOG_CLIENT } from './services/create-processing-request.service';

@Module({
  controllers: [CreateProcessingRequestController],
  providers: [
    CreateProcessingRequestService,
    {
      provide: CATALOG_CLIENT,
      useClass: InMemoryCatalogClient,
    },
  ],
})
export class ProcessingRequestsModule {}
