import { Module } from '@nestjs/common';
import { AgentTestModule } from '../agent-test';
import { AgentsModule } from '../agents';
import { BitrixModule } from '../bitrix';
import { GptMakerModule } from '../gptmaker';
import { SemanticModule } from '../semantic';
import { TenancyModule } from '../tenancy';
import { CrmAccessController } from './crm-access.controller';
import { CrmAccessGuard } from './crm-access.guard';
import { CrmAccessService } from './crm-access.service';
import { CrmClientController } from './crm-client.controller';
import { CrmGuidanceService } from './crm-guidance.service';
import { CrmToolsService } from './crm-tools.service';
import { CrmToolsSync } from './crm-tools.sync';
import { McpController } from './mcp.controller';

@Module({
  imports: [
    TenancyModule,
    AgentsModule,
    AgentTestModule,
    BitrixModule,
    GptMakerModule,
    SemanticModule,
  ],
  controllers: [CrmAccessController, CrmClientController, McpController],
  providers: [CrmAccessService, CrmAccessGuard, CrmGuidanceService, CrmToolsService, CrmToolsSync],
  exports: [CrmAccessService, CrmGuidanceService],
})
export class CrmToolsModule {}
