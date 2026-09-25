import { Controller, Get, Header } from '@nestjs/common';
import { metricsRegistry } from './metrics';

@Controller('metrics')
export class MetricsController {
  @Get()
  @Header('Content-Type', metricsRegistry.contentType)
  metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }
}
