import { Module } from '@nestjs/common';
import { BillingModule } from '../billing';
import { GptMakerModule } from '../gptmaker';
import { TenancyModule } from '../tenancy';
import { AgentTestService } from './agent-test.service';
import { AgentTestsController } from './agent-tests.controller';
import { TestConversations } from './test-conversations';

@Module({
  imports: [TenancyModule, GptMakerModule, BillingModule],
  controllers: [AgentTestsController],
  providers: [AgentTestService, TestConversations],
  exports: [TestConversations],
})
export class AgentTestModule {}
