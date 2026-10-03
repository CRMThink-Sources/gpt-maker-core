import { Module } from '@nestjs/common';
import { BillingModule } from '../billing';
import { TenancyModule } from '../tenancy';
import { AgentItemMirror } from './agent-item.mirror';
import { CreditSummaryService } from './credit-summary.service';
import { CreditsController } from './credits.controller';
import { InstallationEventsConsumer } from './installation-events.consumer';
import { PaymentsOutbox } from './payments-outbox';
import { PaymentsOutboxWorker } from './payments-outbox.worker';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlatformEventStore } from './platform-event.store';
import { PlatformEventsController } from './platform-events.controller';
import { SubscriptionEventsConsumer } from './subscription-events.consumer';
import { SubscriptionEventsService } from './subscription-events.service';
import { TrialController } from './trial.controller';
import { TrialService } from './trial.service';

@Module({
  imports: [BillingModule, TenancyModule],
  controllers: [PlatformEventsController, TrialController, CreditsController, PlansController],
  providers: [
    PlatformEventStore,
    InstallationEventsConsumer,
    PaymentsOutbox,
    AgentItemMirror,
    PaymentsOutboxWorker,
    SubscriptionEventsConsumer,
    SubscriptionEventsService,
    TrialService,
    CreditSummaryService,
    PlansService,
  ],
  exports: [PaymentsOutbox],
})
export class PaymentsModule {}
