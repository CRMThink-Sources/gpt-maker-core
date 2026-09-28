// API pública do módulo: outros módulos só importam daqui.
export {
  BATCH_LIMIT,
  BitrixClient,
  type BatchCommand,
  type BatchResult,
  type BitrixParams,
  type BitrixResponse,
} from './bitrix.client';
export { BitrixError, type BitrixErrorKind } from './bitrix.errors';
export { BitrixModule } from './bitrix.module';
export { PlatformTokenProvider, type PortalToken } from './platform-token.provider';
