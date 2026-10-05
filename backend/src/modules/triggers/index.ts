// API pública do módulo: outros módulos só importam daqui.
export { type AgentEventMessage } from './agent-event.intake';
export { TriggersModule } from './triggers.module';
export { ActionError } from './actions/action-error';
export {
  type ActionResult,
  type ExecutableAction,
  TriggerActionExecutor,
} from './actions/action-executor';
