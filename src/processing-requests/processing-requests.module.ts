import { Module } from '@nestjs/common';
import { ProcessingRequestsController } from './controllers/processing-requests.controller';
import { CATALOG_CLIENT } from './ports/catalog-client.port';
import { ListOwnProcessingRequestsService } from './services/list-own-processing-requests.service';
import { GetOwnProcessingRequestService } from './services/get-own-processing-request.service';
import { InMemoryCatalogClient } from './adapters/in-memory-catalog-client.adapter';
import { HttpCatalogClient } from './adapters/http-catalog-client.adapter';
import { DownloadService } from './services/download.service';
import { StorageModule } from '../storage/storage.module';

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
  imports: [StorageModule],
  controllers: [ProcessingRequestsController],
  providers: [
    ListOwnProcessingRequestsService,
    GetOwnProcessingRequestService,
    DownloadService,
    catalogClientProvider,
  ],
  exports: [CATALOG_CLIENT],
})
export class ProcessingRequestsModule {}
