import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents';
import { ChannelModule } from '../channel';
import { GptMakerModule } from '../gptmaker';
import { TenancyModule } from '../tenancy';
import { TriggersModule } from '../triggers';
import { IntentionEndpointController } from './intention-endpoint.controller';
import { IntentionRunner } from './intention-runner';
import { IntentionService } from './intention.service';
import { IntentionsController } from './intentions.controller';

@Module({
  imports: [TenancyModule, AgentsModule, ChannelModule, GptMakerModule, TriggersModule],
  controllers: [IntentionsController, IntentionEndpointController],
  providers: [IntentionService, IntentionRunner],
  exports: [IntentionService],
})
export class IntentionsModule {}
