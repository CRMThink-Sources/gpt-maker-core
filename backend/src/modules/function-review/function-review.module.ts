import { Module } from '@nestjs/common';
import { AgentFunctionsModule } from '../agent-functions';
import { AgentsModule } from '../agents';
import { BillingModule } from '../billing';
import { GptMakerModule } from '../gptmaker';
import { TenancyModule } from '../tenancy';
import { VibecodeModule } from '../vibecode';
import { AiKeyController } from './ai-key.controller';
import { AiKeyService } from './ai-key.service';
import { AssistByCodeController } from './assist-by-code.controller';
import { AssistController } from './assist.controller';
import { ConversationSourceService } from './conversation-source.service';
import { ConversationsController } from './conversations.controller';
import { FunctionReviewController } from './function-review.controller';
import { FunctionTemplateReader } from './function-template.reader';
import { HallucinationAnalysisService } from './hallucination-analysis.service';
import { HallucinationController } from './hallucination.controller';
import { FunctionReviewService } from './function-review.service';
import { ReviewAiRunner } from './review-ai.runner';
import { ReviewSessionStore } from './review-session.store';

/** Revisão do preenchimento da função (spec agent-knowledge-review). */
@Module({
  imports: [
    AgentFunctionsModule,
    AgentsModule,
    BillingModule,
    GptMakerModule,
    TenancyModule,
    VibecodeModule,
  ],
  controllers: [
    AiKeyController,
    FunctionReviewController,
    AssistController,
    AssistByCodeController,
    ConversationsController,
    HallucinationController,
  ],
  providers: [
    AiKeyService,
    ConversationSourceService,
    FunctionReviewService,
    FunctionTemplateReader,
    HallucinationAnalysisService,
    ReviewAiRunner,
    ReviewSessionStore,
  ],
  exports: [AiKeyService],
})
export class FunctionReviewModule {}
