import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CorrelationContext, correlationContext } from './correlation-context';
import { buildRootLoggerConfig } from './logger.config';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: () => buildRootLoggerConfig(correlationContext),
    }),
  ],
  providers: [{ provide: CorrelationContext, useValue: correlationContext }],
  controllers: [MetricsController],
  exports: [CorrelationContext],
})
export class ObservabilityModule {}
