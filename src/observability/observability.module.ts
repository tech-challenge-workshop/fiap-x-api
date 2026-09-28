import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CorrelationContext } from './correlation-context';
import { buildRootLoggerConfig } from './logger.config';
import { MetricsController } from './metrics.controller';

// One process-wide context: the pino mixin and the injected consumers must
// read the same ALS store or correlation ids would never meet.
const sharedContext = new CorrelationContext();

@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: () => buildRootLoggerConfig(sharedContext),
    }),
  ],
  providers: [{ provide: CorrelationContext, useValue: sharedContext }],
  controllers: [MetricsController],
  exports: [CorrelationContext],
})
export class ObservabilityModule {}
