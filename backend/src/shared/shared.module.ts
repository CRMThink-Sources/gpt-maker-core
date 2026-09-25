import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { LoggingModule } from './logging/logging.module';
import { MessagingModule } from './messaging/messaging.module';
import { RedisModule } from './redis/redis.module';

/** Infraestrutura comum aos dois papéis (api e worker). */
@Module({
  imports: [LoggingModule, DatabaseModule, RedisModule, MessagingModule],
})
export class SharedModule {}
