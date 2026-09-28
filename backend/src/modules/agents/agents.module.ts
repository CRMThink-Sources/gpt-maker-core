import { Module } from '@nestjs/common';
import { GptMakerModule } from '../gptmaker';
import { TenancyModule } from '../tenancy';
import { AgentLifecycleListener } from './agent-lifecycle.listener';

@Module({
  imports: [TenancyModule, GptMakerModule],
  providers: [AgentLifecycleListener],
})
export class AgentsModule {}
