// API pública do módulo: outros módulos só importam daqui.
export { AgentsModule } from './agents.module';
export {
  AgentRepository,
  type Agent,
  type AgentPatch,
  type AgentStatus,
  type NewAgent,
} from './agent.repository';
export { AgentService, hashWebhookToken, type AgentOwner } from './agent.service';
