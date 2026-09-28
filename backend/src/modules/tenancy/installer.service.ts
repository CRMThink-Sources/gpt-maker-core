import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { BitrixClient, PlatformTokenProvider } from '../bitrix';
import { currentContext } from '../../shared/context/request-context';
import { DomainError } from '../../shared/http/api-exception.filter';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import { BitrixEventVerifier } from './bitrix-event.verifier';
import { TenantLifecycle } from './tenant-lifecycle';
import { type Tenant, TenantService } from './tenant.service';

export interface InstallerInput {
  installationId: number;
  memberId: string;
  domain: string;
  isReinstall: boolean;
}

/** A plataforma espera até 60s; sobra margem para a resposta chegar antes do timeout dela. */
const INSTALL_BUDGET_MS = 50_000;

/**
 * Instalador chamado de forma síncrona pela plataforma (design D3): cria ou reativa o tenant,
 * confere o acesso ao portal com o token da plataforma e deixa os módulos refazerem seus
 * registros (chatbots dos agentes ativos na reinstalação). Idempotente: falha ⇒ a instalação
 * fica `INSTALL_PENDING` e "tentar novamente" chama de novo.
 */
@Injectable()
export class InstallerService {
  private readonly logger = new Logger(InstallerService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly tenants: TenantService,
    private readonly lifecycle: TenantLifecycle,
    private readonly bitrix: BitrixClient,
    private readonly tokens: PlatformTokenProvider,
    private readonly eventVerifier: BitrixEventVerifier,
    @Inject(REDIS) redis: Redis,
  ) {
    this.lock = new DistributedLock(redis);
  }

  async install(input: InstallerInput): Promise<Tenant> {
    const outcome = await this.lock.runExclusive(
      `install:${input.installationId}`,
      INSTALL_BUDGET_MS + 10_000,
      () => withBudget(this.run(input), INSTALL_BUDGET_MS),
    );
    if (!outcome.ran) {
      throw new DomainError(
        'INSTALL_IN_PROGRESS',
        'Instalação já em andamento para este portal',
        HttpStatus.CONFLICT,
      );
    }
    return outcome.result;
  }

  private async run(input: InstallerInput): Promise<Tenant> {
    const { tenant, created } = await this.tenants.upsertOnInstall(input);
    // Tokens e application_token mudam na reinstalação: descarta o que houver em cache.
    await Promise.all([
      this.tokens.forget(input.installationId),
      this.eventVerifier.invalidate(input.installationId),
    ]);
    try {
      // Confere que o token da plataforma dá acesso ao portal antes de concluir.
      await this.bitrix.call(input.installationId, 'app.info');
      await this.lifecycle.emit('onInstalled', tenant, {
        reinstall: !created || input.isReinstall,
      });
    } catch (error) {
      const traceId = currentContext()?.traceId;
      this.logger.error({ installationId: input.installationId, err: error }, 'instalação falhou');
      throw new DomainError(
        'INSTALL_FAILED',
        'Não foi possível concluir a instalação; tente novamente',
        HttpStatus.BAD_GATEWAY,
        { traceId },
      );
    }
    this.logger.log(
      { installationId: input.installationId, tenantCode: tenant.tenantCode, created },
      created ? 'tenant criado' : 'tenant reativado',
    );
    return tenant;
  }
}

async function withBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new DomainError(
            'INSTALL_TIMEOUT',
            'Instalação excedeu o tempo; tente novamente',
            HttpStatus.GATEWAY_TIMEOUT,
            { traceId: currentContext()?.traceId },
          ),
        ),
      ms,
    );
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}
