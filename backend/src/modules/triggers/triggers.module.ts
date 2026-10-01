import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { BitrixModule } from '../bitrix';
import { TenancyModule } from '../tenancy';
import { TriggerActionExecutor } from './actions/action-executor';
import { AgentEventIntake } from './agent-event.intake';
import { GptMakerWebhooksController } from './gptmaker-webhooks.controller';
import { TriggerService } from './trigger.service';
import { TriggersController } from './triggers.controller';

/** Webhooks dos agentes e gatilhos (spec agent-triggers). */
@Module({
  imports: [AgentsModule, BitrixModule, TenancyModule],
  controllers: [GptMakerWebhooksController, TriggersController],
  providers: [AgentEventIntake, TriggerActionExecutor, TriggerService],
  exports: [TriggerService],
})
export class TriggersModule {}
