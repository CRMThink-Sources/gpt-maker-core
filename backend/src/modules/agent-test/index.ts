// API pública do módulo: outros módulos só importam daqui.
export { AgentTestModule } from './agent-test.module';
export { TestConversations } from './test-conversations';
export {
  isTestDialog,
  newTestDialogKey,
  TEST_DIALOG_PREFIX,
  testContextId,
  testDialogKeyFrom,
  testDialogOf,
} from './test-dialog';
