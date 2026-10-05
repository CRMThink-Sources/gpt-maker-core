import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminFailure,
  AdminFailuresRanking,
  AdminTenantFailures,
  FailureSource,
} from '@gptmaker/contracts';
import { and, desc, eq, gte, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agent,
  agentIntention,
  intentionExecution,
  messageLog,
  notificationLog,
  paymentEvent,
  paymentsOutbox,
  tenant,
  training,
  trigger,
  triggerExecution,
} from '../../shared/database/schema/index';

const DAY_MS = 86_400_000;
const PER_SOURCE = 20;

/** Onde cada fonte guarda o portal, o momento e a condição de falha. */
interface Source {
  source: FailureSource;
  table: PgTable;
  tenantId: AnyPgColumn;
  at: AnyPgColumn;
  failed: SQL;
}

const SOURCES: Source[] = [
  {
    source: 'message',
    table: messageLog,
    tenantId: messageLog.tenantId,
    at: messageLog.updatedAt,
    failed: eq(messageLog.status, 'FAILED'),
  },
  {
    source: 'trigger',
    table: triggerExecution,
    tenantId: triggerExecution.tenantId,
    at: triggerExecution.createdAt,
    failed: eq(triggerExecution.status, 'FAILED'),
  },
  {
    source: 'intention',
    table: intentionExecution,
    tenantId: intentionExecution.tenantId,
    at: intentionExecution.createdAt,
    failed: eq(intentionExecution.status, 'FAILED'),
  },
  {
    source: 'training',
    table: training,
    tenantId: training.tenantId,
    at: training.updatedAt,
    failed: and(eq(training.status, 'FAILED'), isNull(training.deletedAt))!,
  },
  {
    source: 'platform_event',
    table: paymentEvent,
    tenantId: paymentEvent.tenantId,
    at: paymentEvent.receivedAt,
    failed: eq(paymentEvent.status, 'FAILED'),
  },
  {
    source: 'platform_outbox',
    table: paymentsOutbox,
    tenantId: paymentsOutbox.tenantId,
    at: paymentsOutbox.createdAt,
    failed: eq(paymentsOutbox.status, 'FAILED'),
  },
  {
    source: 'notification',
    table: notificationLog,
    tenantId: notificationLog.tenantId,
    at: notificationLog.createdAt,
    failed: eq(notificationLog.status, 'FAILED'),
  },
];

const TRAINING_TYPES: Record<string, string> = {
  TEXT: 'texto',
  WEBSITE: 'site',
  VIDEO: 'vídeo',
  DOCUMENT: 'documento',
};

/**
 * Erros por portal no backoffice (tarefa 15.7): falhas definitivas registradas no banco, de
 * mensagens que foram para a DLQ (`message_log` `FAILED`, diálogo já transferido) a gatilhos,
 * intenções com ações no Bitrix,
 * treinamentos, eventos da plataforma, chamadas de saída para a plataforma e avisos. Só o que
 * esgotou as tentativas; o que ainda vai ser retentado não aparece.
 */
@Injectable()
export class FailuresService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Portais com falhas desde `since` (padrão: 7 dias), mais falhas primeiro. */
  async ranking(since = new Date(Date.now() - 7 * DAY_MS)): Promise<AdminFailuresRanking[]> {
    const counts = await Promise.all(
      SOURCES.map(async (s) => {
        const rows = await this.db
          .select({
            tenantId: sql<string>`${s.tenantId}`,
            total: sql<number>`count(*)::int`,
            lastAt: sql<Date>`max(${s.at})`,
          })
          .from(s.table)
          .where(and(s.failed, gte(s.at, since), sql`${s.tenantId} is not null`))
          .groupBy(s.tenantId);
        return rows.map((row) => ({ ...row, source: s.source }));
      }),
    );
    const byTenant = new Map<string, Omit<AdminFailuresRanking, 'tenant'>>();
    for (const row of counts.flat()) {
      const current = byTenant.get(row.tenantId) ?? { total: 0, bySource: {}, lastAt: '' };
      current.total += row.total;
      current.bySource[row.source] = row.total;
      const lastAt = new Date(row.lastAt).toISOString();
      if (lastAt > current.lastAt) current.lastAt = lastAt;
      byTenant.set(row.tenantId, current);
    }
    if (byTenant.size === 0) return [];
    const tenants = await this.db
      .select({ id: tenant.id, domain: tenant.domain })
      .from(tenant)
      .where(inArray(tenant.id, [...byTenant.keys()]));
    return tenants
      .map((t) => ({ tenant: t, ...byTenant.get(t.id)! }))
      .sort((a, b) => b.total - a.total || b.lastAt.localeCompare(a.lastAt));
  }

  /** Falhas do portal nos últimos 30 dias, mais recentes primeiro (até 20 por fonte). */
  async ofTenant(tenantId: string, now = new Date()): Promise<AdminTenantFailures> {
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const [messages, triggers, intentions, trainings, events, outbox, notifications] =
      await Promise.all([
        this.db
          .select({
            at: messageLog.updatedAt,
            agent: agent.name,
            dialogId: messageLog.dialogId,
            error: messageLog.error,
            attempts: messageLog.attempts,
          })
          .from(messageLog)
          .innerJoin(agent, eq(agent.id, messageLog.agentId))
          .where(
            and(
              eq(messageLog.tenantId, tenantId),
              eq(messageLog.status, 'FAILED'),
              gte(messageLog.updatedAt, since),
            ),
          )
          .orderBy(desc(messageLog.updatedAt))
          .limit(PER_SOURCE),
        this.db
          .select({
            at: triggerExecution.createdAt,
            name: trigger.name,
            error: triggerExecution.error,
            attempts: triggerExecution.attempts,
          })
          .from(triggerExecution)
          .innerJoin(trigger, eq(trigger.id, triggerExecution.triggerId))
          .where(
            and(
              eq(triggerExecution.tenantId, tenantId),
              eq(triggerExecution.status, 'FAILED'),
              gte(triggerExecution.createdAt, since),
            ),
          )
          .orderBy(desc(triggerExecution.createdAt))
          .limit(PER_SOURCE),
        this.db
          .select({
            at: intentionExecution.createdAt,
            name: agentIntention.name,
            results: intentionExecution.results,
          })
          .from(intentionExecution)
          .innerJoin(agentIntention, eq(agentIntention.id, intentionExecution.intentionId))
          .where(
            and(
              eq(intentionExecution.tenantId, tenantId),
              eq(intentionExecution.status, 'FAILED'),
              gte(intentionExecution.createdAt, since),
            ),
          )
          .orderBy(desc(intentionExecution.createdAt))
          .limit(PER_SOURCE),
        this.db
          .select({
            at: training.updatedAt,
            agent: agent.name,
            type: training.type,
            document: training.documentName,
            url: training.url,
            error: training.error,
          })
          .from(training)
          .innerJoin(agent, eq(agent.id, training.agentId))
          .where(
            and(
              eq(training.tenantId, tenantId),
              eq(training.status, 'FAILED'),
              isNull(training.deletedAt),
              gte(training.updatedAt, since),
            ),
          )
          .orderBy(desc(training.updatedAt))
          .limit(PER_SOURCE),
        this.db
          .select()
          .from(paymentEvent)
          .where(
            and(
              eq(paymentEvent.tenantId, tenantId),
              eq(paymentEvent.status, 'FAILED'),
              gte(paymentEvent.receivedAt, since),
            ),
          )
          .orderBy(desc(paymentEvent.receivedAt))
          .limit(PER_SOURCE),
        this.db
          .select()
          .from(paymentsOutbox)
          .where(
            and(
              eq(paymentsOutbox.tenantId, tenantId),
              eq(paymentsOutbox.status, 'FAILED'),
              gte(paymentsOutbox.createdAt, since),
            ),
          )
          .orderBy(desc(paymentsOutbox.createdAt))
          .limit(PER_SOURCE),
        this.db
          .select()
          .from(notificationLog)
          .where(
            and(
              eq(notificationLog.tenantId, tenantId),
              eq(notificationLog.status, 'FAILED'),
              gte(notificationLog.createdAt, since),
            ),
          )
          .orderBy(desc(notificationLog.createdAt))
          .limit(PER_SOURCE),
      ]);

    const items: AdminFailure[] = [
      ...messages.map((m) => ({
        source: 'message' as const,
        at: m.at.toISOString(),
        subject: `${m.agent} · diálogo ${m.dialogId}`,
        error: m.error,
        attempts: m.attempts,
      })),
      ...triggers.map((t) => ({
        source: 'trigger' as const,
        at: t.at.toISOString(),
        subject: t.name,
        error: t.error,
        attempts: t.attempts,
      })),
      ...intentions.map((i) => ({
        source: 'intention' as const,
        at: i.at.toISOString(),
        subject: i.name,
        error:
          i.results
            .filter((r) => !r.ok)
            .map((r) => `${r.type}: ${r.error ?? 'falhou'}`)
            .join(' · ') || null,
        attempts: null,
      })),
      ...trainings.map((t) => ({
        source: 'training' as const,
        at: t.at.toISOString(),
        subject: `${t.agent} · ${TRAINING_TYPES[t.type] ?? t.type}${
          t.document ? ` ${t.document}` : t.url ? ` ${t.url}` : ''
        }`,
        error: t.error,
        attempts: null,
      })),
      ...events.map((e) => ({
        source: 'platform_event' as const,
        at: e.receivedAt.toISOString(),
        subject: e.type,
        error: e.error,
        attempts: e.attempts,
      })),
      ...outbox.map((o) => ({
        source: 'platform_outbox' as const,
        at: o.createdAt.toISOString(),
        subject: o.operation,
        error: o.lastError,
        attempts: o.attempts,
      })),
      ...notifications.map((n) => ({
        source: 'notification' as const,
        at: n.createdAt.toISOString(),
        subject: n.type,
        error: n.lastError,
        attempts: n.attempts,
      })),
    ];
    items.sort((a, b) => b.at.localeCompare(a.at));
    return { items };
  }
}
