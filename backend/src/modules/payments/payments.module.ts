import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy';
import { InstallationEventsConsumer } from './installation-events.consumer';
import { PlatformEventStore } from './platform-event.store';
import { PlatformEventsController } from './platform-events.controller';

@Module({
  imports: [TenancyModule],
  controllers: [PlatformEventsController],
  providers: [PlatformEventStore, InstallationEventsConsumer],
})
export class PaymentsModule {}
