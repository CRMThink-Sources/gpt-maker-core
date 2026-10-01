import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy';
import { AgentItemMirror } from './agent-item.mirror';
import { InstallationEventsConsumer } from './installation-events.consumer';
import { PaymentsOutbox } from './payments-outbox';
import { PaymentsOutboxWorker } from './payments-outbox.worker';
import { PlatformEventStore } from './platform-event.store';
import { PlatformEventsController } from './platform-events.controller';

@Module({
  imports: [TenancyModule],
  controllers: [PlatformEventsController],
  providers: [
    PlatformEventStore,
    InstallationEventsConsumer,
    PaymentsOutbox,
    AgentItemMirror,
    PaymentsOutboxWorker,
  ],
  exports: [PaymentsOutbox],
})
export class PaymentsModule {}
