import { Module } from '@nestjs/common';
import { BalanceReader } from './balance.reader';
import { CreditCycleService } from './credit-cycle.service';
import { CreditStatementService } from './credit-statement.service';
import { LedgerService } from './ledger.service';
import { UsageDebitConsumer } from './usage-debit.consumer';

@Module({
  providers: [
    BalanceReader,
    CreditCycleService,
    CreditStatementService,
    LedgerService,
    UsageDebitConsumer,
  ],
  exports: [BalanceReader, CreditCycleService, CreditStatementService, LedgerService],
})
export class BillingModule {}
