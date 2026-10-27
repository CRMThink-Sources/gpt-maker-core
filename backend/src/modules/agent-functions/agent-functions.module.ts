import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { CrmToolsModule } from '../crm-tools';
import { GptMakerModule } from '../gptmaker';
import { IntentionsModule } from '../intentions';
import { ModelsModule } from '../models';
import { TenancyModule } from '../tenancy';
import { TrainingModule } from '../training';
import { AgentFunctionService } from './agent-function.service';
import { AgentFunctionsController } from './agent-functions.controller';
import { FunctionCatalog } from './function-catalog.service';
import { FunctionPublicationConsumer } from './function-publication.consumer';
import { FunctionPublisher } from './function-publisher';
import { FunctionSandbox, SandboxIntentionController } from './function-sandbox';
import { FunctionSeeder } from './function-seed';
import { FunctionTrainingPolicy } from './function-training-policy';

/** Funções do agente: templates, blocos, configuração e publicação (specs agent-function-*). */
@Module({
  imports: [
    AgentsModule,
    CrmToolsModule,
    GptMakerModule,
    IntentionsModule,
    ModelsModule,
    TenancyModule,
    TrainingModule,
  ],
  controllers: [AgentFunctionsController, SandboxIntentionController],
  providers: [
    AgentFunctionService,
    FunctionCatalog,
    FunctionPublicationConsumer,
    FunctionPublisher,
    FunctionSandbox,
    FunctionSeeder,
    FunctionTrainingPolicy,
  ],
  exports: [AgentFunctionService, FunctionCatalog, FunctionPublisher, FunctionSandbox],
})
export class AgentFunctionsModule {}
