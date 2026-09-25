import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { InfraHealthIndicators } from './health.indicators';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [InfraHealthIndicators],
})
export class HealthModule {}
