// Tipos do contrato e constantes, sem dependência de Node: seguro para o frontend (`@gptmaker/platform-sdk/api`).
import type { components, operations, paths, webhooks } from './api.gen';

export type { components, operations, paths, webhooks };

type Schemas = components['schemas'];

/** Código da aplicação no crmthink-platform (`aud` do JWT e `appCode` dos eventos). */
export const APP_CODE = 'crmthink.gptmaker';

export type PlatformInstallation = Schemas['Installation'];
export type PlatformTokenResponse = Schemas['Token'];
export type PlatformSession = Schemas['Session'];
export type PlatformSessionRequest = Schemas['SessionRequest'];
export type PlatformInstallerPayload = Schemas['InstallerPayload'];
export type PlatformErrorBody = Schemas['Error'];
