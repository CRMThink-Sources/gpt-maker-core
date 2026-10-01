import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { TenancyModule } from '../tenancy';
import { AgentEventIntake } from './agent-event.intake';
import { GptMakerWebhooksController } from './gptmaker-webhooks.controller';
import { TriggerService } from './trigger.service';
import { TriggersController } from './triggers.controller';

/** Webhooks dos agentes e gatilhos (spec agent-triggers). */
@Module({
  imports: [AgentsModule, TenancyModule],
  controllers: [GptMakerWebhooksController, TriggersController],
  providers: [AgentEventIntake, TriggerService],
  exports: [TriggerService],
})
export class TriggersModule {}
