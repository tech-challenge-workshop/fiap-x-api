import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProcessingRequestsModule } from './processing-requests/processing-requests.module';

@Module({
  imports: [ProcessingRequestsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
