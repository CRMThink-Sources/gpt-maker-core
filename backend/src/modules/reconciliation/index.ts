// API pública do módulo: outros módulos só importam daqui.
export { ReconciliationModule } from './reconciliation.module';
export { dayIn, ReconciliationService } from './reconciliation.service';
export { ModelCostInsights, type ModelCostInsight, STALE_DAYS } from './model-cost-insights';
