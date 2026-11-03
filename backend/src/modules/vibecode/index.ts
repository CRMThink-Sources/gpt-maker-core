// API pública do módulo: outros módulos só importam daqui.
export {
  VibecodeClient,
  type VibecodeChatInput,
  type VibecodeChatResult,
  type VibecodeClientOptions,
  type VibecodeMessage,
} from './vibecode.client';
export { VibecodeError, type VibecodeErrorCode } from './vibecode.errors';
export { VibecodeModule } from './vibecode.module';
