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
import { HumanHandoff } from './human-handoff';
import { InboundConsumer } from './inbound.consumer';
import { InboundGate } from './inbound-gate';
import { InboundRetry } from './inbound-retry';
import { DeliveryFailureHandler } from './delivery-failure.handler';
import { NoCreditHandler } from './no-credit.handler';
import { PendingHandoffs } from './pending-handoff';
import { ReplyPublisher } from './reply-publisher';
import { TransferConsumer } from './transfer.consumer';

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
    DeliveryFailureHandler,
    HumanAttendance,
    HumanHandoff,
    InboundGate,
    InboundConsumer,
    InboundRetry,
    NoCreditHandler,
    PendingHandoffs,
    ReplyPublisher,
    TransferConsumer,
  ],
  exports: [ChatbotService, InboundRetry, PendingHandoffs],
})
export class ChannelModule {}
