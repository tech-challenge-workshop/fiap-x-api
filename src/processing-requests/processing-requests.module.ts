import { Module } from '@nestjs/common';
import { CreateProcessingRequestController } from './controllers/create-processing-request.controller';
import { CreateProcessingRequestService } from './services/create-processing-request.service';
import { CATALOG_CLIENT } from './services/create-processing-request.service';
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
  controllers: [CreateProcessingRequestController],
  providers: [CreateProcessingRequestService, catalogClientProvider],
})
export class ProcessingRequestsModule {}
