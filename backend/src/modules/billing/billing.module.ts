import { Module } from '@nestjs/common';
import { BalanceReader } from './balance.reader';
import { LedgerService } from './ledger.service';
import { UsageDebitConsumer } from './usage-debit.consumer';

@Module({
  providers: [BalanceReader, LedgerService, UsageDebitConsumer],
  exports: [BalanceReader, LedgerService],
})
export class BillingModule {}
