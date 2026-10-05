import { Module } from '@nestjs/common';
import { BillingModule } from '../billing';
import { GptMakerModule } from '../gptmaker';
import { ModelCostInsights } from './model-cost-insights';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [BillingModule, GptMakerModule],
  providers: [ModelCostInsights, ReconciliationService],
  exports: [ModelCostInsights, ReconciliationService],
})
export class ReconciliationModule {}
