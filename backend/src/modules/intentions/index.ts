// API pública do módulo: outros módulos só importam daqui.
export { IntentionService, type ManagedAccess as IntentionAccess } from './intention.service';
export { dialogFromChat } from './intention-runner';
export { IntentionsModule } from './intentions.module';
