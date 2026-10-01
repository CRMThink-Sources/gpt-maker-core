import { Module } from '@nestjs/common';
import { GptMakerModule } from '../gptmaker';
import { ModelsModule } from '../models';
import { PaymentsModule } from '../payments';
import { TenancyModule } from '../tenancy';
import { AgentAccessPolicy } from './agent-access.policy';
import { AgentEvents } from './agent-events';
import { AgentLifecycleListener } from './agent-lifecycle.listener';
import { AgentRepository } from './agent.repository';
import { AgentService } from './agent.service';
import { AgentWebhooksSync } from './agent-webhooks.sync';
import { AgentsController, AppModelsController } from './agents.controller';

@Module({
  imports: [TenancyModule, GptMakerModule, ModelsModule, PaymentsModule],
  controllers: [AgentsController, AppModelsController],
  providers: [
    AgentAccessPolicy,
    AgentEvents,
    AgentLifecycleListener,
    AgentRepository,
    AgentService,
    AgentWebhooksSync,
  ],
  exports: [AgentEvents, AgentRepository, AgentService],
})
export class AgentsModule {}
