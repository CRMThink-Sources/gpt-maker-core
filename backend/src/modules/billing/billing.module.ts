import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications';
import { BalanceReader } from './balance.reader';
import { CreditAlerts } from './credit-alerts';
import { CreditCycleService } from './credit-cycle.service';
import { CreditStatementService } from './credit-statement.service';
import { LedgerService } from './ledger.service';
import { UsageDebitConsumer } from './usage-debit.consumer';

@Module({
  imports: [NotificationsModule],
  providers: [
    CreditAlerts,
    BalanceReader,
    CreditCycleService,
    CreditStatementService,
    LedgerService,
    UsageDebitConsumer,
  ],
  exports: [BalanceReader, CreditCycleService, CreditStatementService, LedgerService],
})
export class BillingModule {}
