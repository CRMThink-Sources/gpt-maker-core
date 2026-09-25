import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { InfraHealthIndicators } from './health.indicators';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: InfraHealthIndicators,
  ) {}

  /** Processo vivo; usado pelo healthcheck do container. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Dependências acessíveis; usado no deploy antes de liberar tráfego. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.indicators.postgres(),
      () => this.indicators.redisPing(),
      () => this.indicators.rabbitmq(),
    ]);
  }
}
