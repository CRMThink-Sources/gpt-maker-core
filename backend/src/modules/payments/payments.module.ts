import { Module } from '@nestjs/common';
import { BillingModule } from '../billing';
import { TenancyModule } from '../tenancy';
import { AgentItemMirror } from './agent-item.mirror';
import { InstallationEventsConsumer } from './installation-events.consumer';
import { PaymentsOutbox } from './payments-outbox';
import { PaymentsOutboxWorker } from './payments-outbox.worker';
import { PlatformEventStore } from './platform-event.store';
import { PlatformEventsController } from './platform-events.controller';
import { SubscriptionEventsConsumer } from './subscription-events.consumer';
import { SubscriptionEventsService } from './subscription-events.service';

@Module({
  imports: [BillingModule, TenancyModule],
  controllers: [PlatformEventsController],
  providers: [
    PlatformEventStore,
    InstallationEventsConsumer,
    PaymentsOutbox,
    AgentItemMirror,
    PaymentsOutboxWorker,
    SubscriptionEventsConsumer,
    SubscriptionEventsService,
  ],
  exports: [PaymentsOutbox],
})
export class PaymentsModule {}
