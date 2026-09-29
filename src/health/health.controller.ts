import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';

@Public()
@Controller('health')
export class HealthController {
  @Get()
  getHealth(): { status: string } {
    return { status: 'ok' };
  }

  /** Liveness: 200 while the event loop is responsive, dependencies aside. */
  @Get('live')
  getLive(): { status: string } {
    return { status: 'ok' };
  }
}
