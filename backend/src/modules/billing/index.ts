// API pública do módulo: outros módulos só importam daqui.
export { BillingModule } from './billing.module';
export { balanceCacheKey, BalanceReader } from './balance.reader';
export {
  type BalanceView,
  DEBIT_ORDER,
  LedgerService,
  type OperationInput,
  type OperationResult,
  splitOutflow,
  type Wallet,
} from './ledger.service';
