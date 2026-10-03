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
import { TrialController } from './trial.controller';
import { TrialService } from './trial.service';

@Module({
  imports: [BillingModule, TenancyModule],
  controllers: [PlatformEventsController, TrialController],
  providers: [
    PlatformEventStore,
    InstallationEventsConsumer,
    PaymentsOutbox,
    AgentItemMirror,
    PaymentsOutboxWorker,
    SubscriptionEventsConsumer,
    SubscriptionEventsService,
    TrialService,
  ],
  exports: [PaymentsOutbox],
})
export class PaymentsModule {}
