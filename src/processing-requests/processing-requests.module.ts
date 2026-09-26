import { Module } from '@nestjs/common';
import { ProcessingRequestsController } from './controllers/processing-requests.controller';
import { CreateProcessingRequestService } from './services/create-processing-request.service';
import { CATALOG_CLIENT } from './services/create-processing-request.service';
import { ListOwnProcessingRequestsService } from './services/list-own-processing-requests.service';
import { InMemoryCatalogClient } from './adapters/in-memory-catalog-client.adapter';
import { HttpCatalogClient } from './adapters/http-catalog-client.adapter';

const catalogClientProvider = {
  provide: CATALOG_CLIENT,
  useFactory: (): InMemoryCatalogClient | HttpCatalogClient => {
    const baseUrl = process.env.CATALOG_BASE_URL;
    return baseUrl
      ? new HttpCatalogClient(baseUrl)
      : new InMemoryCatalogClient();
  },
};

@Module({
  controllers: [ProcessingRequestsController],
  providers: [
    CreateProcessingRequestService,
    ListOwnProcessingRequestsService,
    catalogClientProvider,
  ],
})
export class ProcessingRequestsModule {}
