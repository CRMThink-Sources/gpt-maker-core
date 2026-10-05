import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { TrialRequest, TrialStatusView } from '@gptmaker/contracts';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DB, type Database } from '../../shared/database/database.module';
import { subscriptionState } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import {
  isPlatformUnavailable,
  PlatformApiClient,
  PlatformError,
} from '../../shared/platform/platform-api.client';
import { REDIS } from '../../shared/redis/redis.module';
import { LedgerService } from '../billing';

/** Cadastro aceito e evento ainda não chegou; passado o prazo, a tela volta a oferecer o trial. */
const ACTIVATING_TTL_SECONDS = 15 * 60;

export const trialActivatingKey = (tenantId: string) => `payments:trial-activating:${tenantId}`;

/**
 * Trial liberado por cadastro (spec payments-integration, design D9 "Trial por cadastro"). A
 * oferta vem da projeção local: tenant sem `subscription_state` nunca recebeu trial nem plano. A
 * decisão final é da plataforma (`TRIAL_ALREADY_USED`), que também guarda o contato: o app só
 * repassa, nunca grava nem registra os dados em log. Os créditos saem só do
 * `subscription.trial_started` (`SubscriptionEventsService`).
 */
@Injectable()
export class TrialService {
  private readonly logger = new Logger(TrialService.name);

  constructor(
    private readonly platform: PlatformApiClient,
    private readonly ledger: LedgerService,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async status(tenantId: string): Promise<TrialStatusView> {
    const [projection] = await this.db
      .select({ status: subscriptionState.status })
      .from(subscriptionState)
      .where(eq(subscriptionState.tenantId, tenantId));
    if (projection?.status === 'trialing') {
      const { trialEndsAt } = await this.ledger.balance(tenantId);
      return { state: 'trialing', trialEndsAt: trialEndsAt?.toISOString() ?? null };
    }
    if (projection) return { state: 'unavailable', trialEndsAt: null };

    const activating = await this.redis.get(trialActivatingKey(tenantId));
    if (activating !== null) return { state: 'activating', trialEndsAt: activating || null };
    return { state: 'available', trialEndsAt: null };
  }

  async request(
    tenantId: string,
    installationId: number,
    contact: TrialRequest,
  ): Promise<TrialStatusView> {
    try {
      const result = await this.platform.requestTrial(installationId, contact);
      await this.redis.set(
        trialActivatingKey(tenantId),
        result.trialEndsAt ?? '',
        'EX',
        ACTIVATING_TTL_SECONDS,
      );
      this.logger.log(
        { installationId, subscriptionId: result.subscriptionId, created: result.created },
        'trial solicitado',
      );
    } catch (error) {
      throw this.toDomainError(error, installationId);
    }
    return this.status(tenantId);
  }

  private toDomainError(error: unknown, installationId: number): unknown {
    if (isPlatformUnavailable(error)) {
      return new DomainError(
        'PLATFORM_UNAVAILABLE',
        'Não foi possível ativar o teste agora. Tente de novo em instantes.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!(error instanceof PlatformError)) return error;
    switch (error.code) {
      case 'VALIDATION_ERROR':
        return new DomainError(
          'VALIDATION_ERROR',
          'Confira os dados do cadastro.',
          HttpStatus.BAD_REQUEST,
          error.details,
        );
      case 'TRIAL_ALREADY_USED':
        return new DomainError(
          'TRIAL_ALREADY_USED',
          'O período de teste deste portal já foi utilizado.',
          HttpStatus.CONFLICT,
        );
      case 'SUBSCRIPTION_ALREADY_EXISTS':
        // A projeção local não conhece a assinatura: evento perdido ou atrasado (12.10 corrige).
        this.logger.warn({ installationId }, 'trial recusado: assinatura que a projeção não tem');
        return new DomainError(
          'SUBSCRIPTION_ALREADY_EXISTS',
          'Este portal já tem uma assinatura.',
          HttpStatus.CONFLICT,
        );
      case 'TRIAL_NOT_CONFIGURED':
        this.logger.error({ alert: true, installationId }, 'trial não configurado na plataforma');
        return new DomainError(
          'TRIAL_UNAVAILABLE',
          'O teste grátis não está disponível no momento.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      default:
        return error;
    }
  }
}
