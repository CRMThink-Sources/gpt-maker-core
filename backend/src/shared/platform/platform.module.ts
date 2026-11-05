import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PlatformApiClient } from './platform-api.client';
import { PlatformSignatureGuard } from './platform-signature.guard';
import { SESSION_VERIFIER, sessionVerifier } from './session-verifier';

/**
 * crmthink-platform como infraestrutura externa comum (design D3/D9): cliente da API com a
 * chave do app, verificação da assinatura dos webhooks e do JWT da sessão do iframe.
 */
@Global()
@Module({
  providers: [
    {
      provide: PlatformApiClient,
      inject: [ENV],
      useFactory: (env: Env) =>
        new PlatformApiClient({
          baseUrl: env.PLATFORM_URL,
          apiKey: env.PLATFORM_API_KEY,
          timeoutMs: env.PLATFORM_TIMEOUT_MS,
        }),
    },
    {
      provide: SESSION_VERIFIER,
      inject: [ENV],
      useFactory: (env: Env) =>
        sessionVerifier({
          platformUrl: env.PLATFORM_URL,
          appCode: env.APP_CODE,
          issuer: env.PLATFORM_JWT_ISSUER,
        }),
    },
    PlatformSignatureGuard,
  ],
  exports: [PlatformApiClient, SESSION_VERIFIER, PlatformSignatureGuard],
})
export class PlatformModule {}
