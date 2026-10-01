import { Module } from '@nestjs/common';
import { AgentEventIntake } from './agent-event.intake';
import { GptMakerWebhooksController } from './gptmaker-webhooks.controller';

/** Webhooks dos agentes e gatilhos (spec agent-triggers). */
@Module({
  controllers: [GptMakerWebhooksController],
  providers: [AgentEventIntake],
})
export class TriggersModule {}
