// API pública do módulo: outros módulos só importam daqui.
export { fromGptMakerName, tenantCodeFromGptMakerName, toGptMakerName } from './agent-naming';
export { collectAllPages } from './collect-pages';
export { GptMakerClient } from './gptmaker.client';
export { GptMakerError, type GptMakerErrorKind } from './gptmaker.errors';
export { GptMakerModule } from './gptmaker.module';
export * from './gptmaker.schemas';
export { TenantAgentLimitService } from './tenant-agent-limit.service';
