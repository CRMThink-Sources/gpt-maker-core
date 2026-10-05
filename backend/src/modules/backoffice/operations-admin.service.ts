import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminDeadLetterPeek,
  AdminDeadLetterQueue,
  AdminOperationsView,
  DeadLetterQueueKey,
} from '@gptmaker/contracts';
import { inArray } from 'drizzle-orm';
import { DB, type Database } from '../../shared/database/database.module';
import { tenant } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { AuditService } from './audit.service';
import { DEAD_LETTER_QUEUES, DeadLetterInspector } from './dead-letter-inspector';
import { FailuresService } from './failures.service';

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function isQueueKey(value: string): value is DeadLetterQueueKey {
  return value in DEAD_LETTER_QUEUES;
}

/** DLQs do canal e falhas por portal no backoffice (tarefa 15.7). */
@Injectable()
export class OperationsAdminService {
  constructor(
    private readonly inspector: DeadLetterInspector,
    private readonly failures: FailuresService,
    private readonly audit: AuditService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async overview(): Promise<AdminOperationsView> {
    const keys = Object.keys(DEAD_LETTER_QUEUES) as DeadLetterQueueKey[];
    const [queues, ranking] = await Promise.all([
      Promise.all(keys.map((key) => this.queue(key))),
      this.failures.ranking(),
    ]);
    return { queues, ranking };
  }

  async peek(key: DeadLetterQueueKey, limit: number): Promise<AdminDeadLetterPeek> {
    const [queue, metas] = await Promise.all([
      this.queue(key),
      this.inspector.peek(key, limit).catch(() => {
        throw new DomainError(
          'QUEUE_UNAVAILABLE',
          'Não foi possível ler a fila agora (RabbitMQ indisponível?).',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }),
    ]);
    const ids = [...new Set(metas.map((m) => m.tenantId))].filter(
      (id): id is string => id !== null && UUID.test(id),
    );
    const tenants = ids.length
      ? await this.db
          .select({ id: tenant.id, domain: tenant.domain })
          .from(tenant)
          .where(inArray(tenant.id, ids))
      : [];
    return {
      queue,
      messages: metas.map(({ tenantId, ...meta }) => ({
        ...meta,
        tenant: tenants.find((t) => t.id === tenantId) ?? null,
      })),
    };
  }

  /** Descarta tudo da DLQ (as mensagens já foram tratadas: diálogo transferido ou alerta). */
  async purge(key: DeadLetterQueueKey, actor: string): Promise<{ purged: number }> {
    const purged = await this.inspector.purge(key);
    await this.audit.record({
      actorId: actor,
      action: 'operations.dlq_purged',
      entityType: 'queue',
      entityId: DEAD_LETTER_QUEUES[key],
      after: { purged },
    });
    return { purged };
  }

  private async queue(key: DeadLetterQueueKey): Promise<AdminDeadLetterQueue> {
    return { key, name: DEAD_LETTER_QUEUES[key], messages: await this.inspector.size(key) };
  }
}
