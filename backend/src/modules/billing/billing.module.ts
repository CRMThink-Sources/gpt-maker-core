import { Module } from '@nestjs/common';
import { BalanceReader } from './balance.reader';
import { CreditCycleService } from './credit-cycle.service';
import { LedgerService } from './ledger.service';
import { UsageDebitConsumer } from './usage-debit.consumer';

@Module({
  providers: [BalanceReader, CreditCycleService, LedgerService, UsageDebitConsumer],
  exports: [BalanceReader, CreditCycleService, LedgerService],
})
export class BillingModule {}
