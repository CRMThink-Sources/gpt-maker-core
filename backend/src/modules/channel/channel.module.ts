import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { BillingModule } from '../billing';
import { BitrixModule } from '../bitrix';
import { TenancyModule } from '../tenancy';
import { BotEventsController } from './bot-events.controller';
import { BotEventsService } from './bot-events.service';
import { ChatbotSync } from './chatbot-sync';
import { ChatbotService } from './chatbot.service';
import { HumanAttendance } from './human-attendance';
import { InboundConsumer } from './inbound.consumer';
import { InboundGate } from './inbound-gate';
import { InboundRetry } from './inbound-retry';

/** Canal chatbot do Bitrix (spec bitrix-chatbot-channel). */
@Module({
  imports: [AgentsModule, BillingModule, BitrixModule, TenancyModule],
  controllers: [BotEventsController],
  providers: [
    ChatbotService,
    ChatbotSync,
    BotEventsService,
    HumanAttendance,
    InboundGate,
    InboundConsumer,
    InboundRetry,
  ],
  exports: [ChatbotService, InboundRetry],
})
export class ChannelModule {}
