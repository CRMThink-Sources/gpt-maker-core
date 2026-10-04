import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { GptMakerModule } from '../gptmaker';
import { TenancyModule } from '../tenancy';
import { IntentionService } from './intention.service';
import { IntentionsController } from './intentions.controller';

@Module({
  imports: [TenancyModule, AgentsModule, GptMakerModule],
  controllers: [IntentionsController],
  providers: [IntentionService],
  exports: [IntentionService],
})
export class IntentionsModule {}
