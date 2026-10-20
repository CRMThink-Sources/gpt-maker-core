// API pública do módulo: outros módulos só importam daqui.
export { AgentTestModule } from './agent-test.module';
export { TestConversations } from './test-conversations';
export {
  isTestDialog,
  TEST_DIALOG_PREFIX,
  testContextId,
  testConversationIdFrom,
} from './test-dialog';
