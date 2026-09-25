import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorResult } from '@nestjs/terminus';
import { HealthRegistry } from './health-registry';
import { InfraHealthIndicators } from './health.indicators';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: InfraHealthIndicators,
    private readonly registry: HealthRegistry,
  ) {}

  /** Processo vivo; usado pelo healthcheck do container. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /**
   * Infraestrutura própria acessível; usado no deploy antes de liberar tráfego. Não inclui
   * provedores externos: uma queda do GPTMaker não deve reverter um deploy.
   */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.indicators.postgres(),
      () => this.indicators.redisPing(),
      () => this.indicators.rabbitmq(),
    ]);
  }

  /** Visão completa: infraestrutura + componentes externos (GPTMaker, ...), para monitoramento. */
  @Get()
  @HealthCheck()
  full() {
    return this.health.check([
      () => this.indicators.postgres(),
      () => this.indicators.redisPing(),
      () => this.indicators.rabbitmq(),
      async () => (await this.registry.checkAll()) as HealthIndicatorResult,
    ]);
  }
}
