import { Module } from '@nestjs/common';
import { GptMakerModule } from '../gptmaker';
import { ModelsModule } from '../models';
import { PaymentsModule } from '../payments';
import { TenancyModule } from '../tenancy';
import { AgentLifecycleListener } from './agent-lifecycle.listener';
import { AgentRepository } from './agent.repository';
import { AgentService } from './agent.service';
import { AgentsController } from './agents.controller';

@Module({
  imports: [TenancyModule, GptMakerModule, ModelsModule, PaymentsModule],
  controllers: [AgentsController],
  providers: [AgentLifecycleListener, AgentRepository, AgentService],
  exports: [AgentRepository, AgentService],
})
export class AgentsModule {}
