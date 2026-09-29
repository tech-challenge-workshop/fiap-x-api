import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProcessingRequestsModule } from './processing-requests/processing-requests.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { StorageModule } from './storage/storage.module';
import { UploadsModule } from './uploads/uploads.module';
import { ObservabilityModule } from './observability/observability.module';
import { CorrelationMiddleware } from './observability/correlation.middleware';
import { HttpMetricsMiddleware } from './observability/http-metrics.middleware';

@Module({
  imports: [
    ObservabilityModule,
    AuthModule,
    StorageModule,
    ProcessingRequestsModule,
    UploadsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware, HttpMetricsMiddleware).forRoutes('*');
  }
}
