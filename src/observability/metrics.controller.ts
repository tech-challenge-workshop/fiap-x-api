import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { apiMetrics } from './metrics';

/** Prometheus scrape endpoint; unauthenticated by convention (AD-017). */
@Public()
@Controller()
export class MetricsController {
  @Get('metrics')
  async metrics(@Res() res: Response): Promise<void> {
    // Raw setHeader + end: express's res.send would reflect '; charset=utf-8'
    // into the value, and the exposition contract pins it exactly.
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.end(await apiMetrics.metrics());
  }
}
