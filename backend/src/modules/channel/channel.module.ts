import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { BillingModule } from '../billing';
import { BitrixModule } from '../bitrix';
import { GptMakerModule } from '../gptmaker';
import { TenancyModule } from '../tenancy';
import { BotEventsController } from './bot-events.controller';
import { BotEventsService } from './bot-events.service';
import { ChatbotSync } from './chatbot-sync';
import { ChatMedia } from './chat-media';
import { ChatbotService } from './chatbot.service';
import { ConversationService } from './conversation.service';
import { HumanAttendance } from './human-attendance';
import { InboundConsumer } from './inbound.consumer';
import { InboundGate } from './inbound-gate';
import { InboundRetry } from './inbound-retry';

/** Canal chatbot do Bitrix (spec bitrix-chatbot-channel). */
@Module({
  imports: [AgentsModule, BillingModule, BitrixModule, GptMakerModule, TenancyModule],
  controllers: [BotEventsController],
  providers: [
    ChatbotService,
    ChatbotSync,
    BotEventsService,
    ChatMedia,
    ConversationService,
    HumanAttendance,
    InboundGate,
    InboundConsumer,
    InboundRetry,
  ],
  exports: [ChatbotService, InboundRetry],
})
export class ChannelModule {}
