import { Module } from '@nestjs/common';
import { AgentFunctionsModule } from '../agent-functions';
import { AgentsModule } from '../agents';
import { BillingModule } from '../billing';
import { TenancyModule } from '../tenancy';
import { VibecodeModule } from '../vibecode';
import { AiKeyController } from './ai-key.controller';
import { AiKeyService } from './ai-key.service';
import { AssistController } from './assist.controller';
import { FunctionReviewController } from './function-review.controller';
import { FunctionReviewService } from './function-review.service';
import { ReviewSessionStore } from './review-session.store';

/** Revisão do preenchimento da função (spec agent-knowledge-review). */
@Module({
  imports: [AgentFunctionsModule, AgentsModule, BillingModule, TenancyModule, VibecodeModule],
  controllers: [AiKeyController, FunctionReviewController, AssistController],
  providers: [AiKeyService, FunctionReviewService, ReviewSessionStore],
  exports: [AiKeyService],
})
export class FunctionReviewModule {}
