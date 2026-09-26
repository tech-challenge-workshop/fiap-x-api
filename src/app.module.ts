import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProcessingRequestsModule } from './processing-requests/processing-requests.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [AuthModule, ProcessingRequestsModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
