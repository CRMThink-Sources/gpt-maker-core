import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { BitrixModule } from '../bitrix';
import { TenancyModule } from '../tenancy';
import { BotEventsController } from './bot-events.controller';
import { BotEventsService } from './bot-events.service';
import { ChatbotSync } from './chatbot-sync';
import { ChatbotService } from './chatbot.service';

/** Canal chatbot do Bitrix (spec bitrix-chatbot-channel). */
@Module({
  imports: [AgentsModule, BitrixModule, TenancyModule],
  controllers: [BotEventsController],
  providers: [ChatbotService, ChatbotSync, BotEventsService],
  exports: [ChatbotService],
})
export class ChannelModule {}
