import { Module } from '@nestjs/common';
import { BalanceReader } from './balance.reader';

@Module({
  providers: [BalanceReader],
  exports: [BalanceReader],
})
export class BillingModule {}
