import { Module } from '@nestjs/common';
import { GptMakerModule } from '../gptmaker';
import { ModelsModule } from '../models';
import { NotificationsModule } from '../notifications';
import { PaymentsModule } from '../payments';
import { TenancyModule } from '../tenancy';
import { AgentAccessPolicy } from './agent-access.policy';
import { AgentEvents } from './agent-events';
import { AgentLifecycleListener } from './agent-lifecycle.listener';
import { AgentPlanModels } from './agent-plan-models';
import { AgentRepository } from './agent.repository';
import { AgentService } from './agent.service';
import { AgentWebhooksSync } from './agent-webhooks.sync';
import { AgentsController, AppModelsController } from './agents.controller';

@Module({
  imports: [TenancyModule, GptMakerModule, ModelsModule, NotificationsModule, PaymentsModule],
  controllers: [AgentsController, AppModelsController],
  providers: [
    AgentAccessPolicy,
    AgentEvents,
    AgentLifecycleListener,
    AgentPlanModels,
    AgentRepository,
    AgentService,
    AgentWebhooksSync,
  ],
  exports: [AgentEvents, AgentRepository, AgentService],
})
export class AgentsModule {}
