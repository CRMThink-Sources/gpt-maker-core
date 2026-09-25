import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthRegistry } from './health/health-registry';
import { LoggingModule } from './logging/logging.module';
import { MessagingModule } from './messaging/messaging.module';
import { RedisModule } from './redis/redis.module';

/** Infraestrutura comum aos dois papéis (api e worker). */
@Global()
@Module({
  imports: [LoggingModule, DatabaseModule, RedisModule, MessagingModule],
  providers: [HealthRegistry],
  exports: [HealthRegistry],
})
export class SharedModule {}
