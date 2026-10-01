import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { BitrixModule } from '../bitrix';
import { TenancyModule } from '../tenancy';
import { ChatbotSync } from './chatbot-sync';
import { ChatbotService } from './chatbot.service';

/** Canal chatbot do Bitrix (spec bitrix-chatbot-channel). */
@Module({
  imports: [AgentsModule, BitrixModule, TenancyModule],
  providers: [ChatbotService, ChatbotSync],
  exports: [ChatbotService],
})
export class ChannelModule {}
