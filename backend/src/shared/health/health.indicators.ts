import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { REDIS } from '../redis/redis.module';

@Injectable()
export class InfraHealthIndicators {
  constructor(
    private readonly health: HealthIndicatorService,
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly amqp: AmqpConnection,
  ) {}

  async postgres() {
    const indicator = this.health.check('postgres');
    try {
      await this.pool.query('SELECT 1');
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }

  async redisPing() {
    const indicator = this.health.check('redis');
    try {
      await this.redis.ping();
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }

  rabbitmq() {
    const indicator = this.health.check('rabbitmq');
    return this.amqp.managedConnection.isConnected() ? indicator.up() : indicator.down();
  }
}
