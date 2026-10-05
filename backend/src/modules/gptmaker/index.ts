// API pública do módulo: outros módulos só importam daqui.
export { fromGptMakerName, tenantCodeFromGptMakerName } from './agent-naming';
export { collectAllPages } from './collect-pages';
export { GptMakerClient } from './gptmaker.client';
export { GptMakerError, type GptMakerErrorKind } from './gptmaker.errors';
export { GptMakerModule } from './gptmaker.module';
export * from './gptmaker.schemas';
export { TenantAgentLimitService } from './tenant-agent-limit.service';
export { WorkspaceHealthService } from './workspace-health.service';
export { type WorkspaceStatus, WorkspaceStatusStore } from './workspace-status.store';
export { type SyncSummary, WorkspaceSyncService } from './workspace-sync.service';
