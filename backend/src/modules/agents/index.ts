// API pública do módulo: outros módulos só importam daqui.
export { AgentsModule } from './agents.module';
export { AgentEvents, type AgentChange, type AgentChangeListener } from './agent-events';
export {
  AgentRepository,
  type Agent,
  type AgentPatch,
  type AgentStatus,
  type NewAgent,
} from './agent.repository';
export { AgentService, hashWebhookToken, webhookUrlsFor, type AgentOwner } from './agent.service';
