import { Module } from '@nestjs/common';
import { BalanceReader } from './balance.reader';
import { LedgerService } from './ledger.service';

@Module({
  providers: [BalanceReader, LedgerService],
  exports: [BalanceReader, LedgerService],
})
export class BillingModule {}
