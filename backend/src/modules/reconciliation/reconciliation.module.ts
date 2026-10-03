import { Module } from '@nestjs/common';
import { BillingModule } from '../billing';
import { GptMakerModule } from '../gptmaker';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [BillingModule, GptMakerModule],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
