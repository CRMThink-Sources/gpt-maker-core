import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthRegistry } from './health/health-registry';
import { LoggingModule } from './logging/logging.module';
import { MessagingModule } from './messaging/messaging.module';
import { PlatformModule } from './platform/platform.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';

/** Infraestrutura comum aos dois papéis (api e worker). */
@Global()
@Module({
  imports: [
    LoggingModule,
    DatabaseModule,
    RedisModule,
    MessagingModule,
    PlatformModule,
    StorageModule,
  ],
  providers: [HealthRegistry],
  exports: [HealthRegistry],
})
export class SharedModule {}
