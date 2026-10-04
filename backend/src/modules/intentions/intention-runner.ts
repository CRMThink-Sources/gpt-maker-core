import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TemplateContext } from '@gptmaker/contracts';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { fieldCipher } from '../../shared/crypto/field-cipher';
import { DB, type Database } from '../../shared/database/database.module';
import {
  agent,
  agentIntention,
  intentionExecution,
  tenant,
} from '../../shared/database/schema/index';
import { REDIS } from '../../shared/redis/redis.module';
import { PendingHandoffs } from '../channel';
import { ActionError, type ExecutableAction, TriggerActionExecutor } from '../triggers';

/** Repetição da mesma chamada (GPTMaker refazendo após demora) devolve o resultado guardado. */
const DEDUPE_SECONDS = 5 * 60;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
/** Variável que o GPTMaker não preencheu chega como o próprio texto (`{{chat_id}}`). */
const UNFILLED = /^\s*\{\{[^{}]*\}\}\s*$/;

const ACTION_LABELS: Record<string, string> = {
  CREATE_LEAD: 'lead criado',
  UPSERT_DEAL: 'negócio registrado',
  TIMELINE_COMMENT: 'comentário registrado no CRM',
  CREATE_TASK: 'tarefa criada',
  START_BIZPROC: 'processo iniciado',
  TRANSFER_TO_HUMAN: 'transferência para um atendente agendada',
};

export interface IntentionReply {
  ok: boolean;
  /** Texto para o agente usar na resposta ao cliente. */
  message: string;
  results: Array<{ type: string; ok: boolean; result?: Record<string, unknown>; error?: string }>;
}

export type RunOutcome = { kind: 'unauthorized' } | { kind: 'reply'; reply: IntentionReply };

function text(value: unknown): string {
  if (typeof value === 'string') return UNFILLED.test(value) ? '' : value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function sameToken(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Diálogo do Bitrix no chat do GPTMaker (`public-api-<agente>-<tenantId>:<diálogo>`). */
export function dialogFromChat(chat: string, tenantId: string): string | null {
  const marker = `${tenantId}:`;
  const at = chat.indexOf(marker);
  return at >= 0 ? chat.slice(at + marker.length) || null : null;
}

/** Resumo para o agente: o que foi feito e o que falhou, sem detalhe técnico. */
export function summarize(results: IntentionReply['results']): string {
  const done = results.filter((r) => r.ok).map((r) => ACTION_LABELS[r.type] ?? r.type);
  const failed = results.filter((r) => !r.ok).length;
  const transfer = results.some((r) => r.type === 'TRANSFER_TO_HUMAN' && r.ok)
    ? ' Avise o cliente que ele será atendido por uma pessoa da equipe em seguida.'
    : '';
  if (!failed) return `Feito: ${done.join('; ')}.${transfer}`;
  if (!done.length) {
    return 'Não foi possível registrar no CRM agora. Peça desculpas ao cliente e diga que a equipe vai dar continuidade.';
  }
  return `Feito em parte: ${done.join('; ')}. ${failed} ação(ões) não foram concluídas; a equipe vai verificar.${transfer}`;
}

/**
 * Executa uma intenção "Ação no Bitrix24" chamada pelo GPTMaker (spec agent-intentions, design
 * D21): confere o token da intenção, o portal e o diálogo, roda as ações dos gatilhos em ordem com
 * os campos coletados e devolve um texto para o agente responder. Síncrono e sem retentativa: o
 * agente está esperando para responder ao cliente.
 */
@Injectable()
export class IntentionRunner {
  private readonly logger = new Logger(IntentionRunner.name);

  constructor(
    private readonly executor: TriggerActionExecutor,
    private readonly handoffs: PendingHandoffs,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async run(id: string, token: string | undefined, body: unknown): Promise<RunOutcome> {
    if (!UUID.test(id) || !token) return { kind: 'unauthorized' };
    const [row] = await this.db
      .select({
        intention: agentIntention,
        agentName: agent.name,
        installationId: tenant.installationId,
        tenantStatus: tenant.status,
      })
      .from(agentIntention)
      .innerJoin(agent, eq(agent.id, agentIntention.agentId))
      .innerJoin(tenant, eq(tenant.id, agentIntention.tenantId))
      .where(eq(agentIntention.id, id));
    const intention = row?.intention;
    if (
      !row ||
      !intention ||
      intention.kind !== 'BITRIX' ||
      !intention.tokenEncrypted ||
      !sameToken(fieldCipher().decrypt(intention.tokenEncrypted), token)
    ) {
      this.logger.warn(
        { alert: 'security', intentionId: id },
        'intenção chamada com token inválido',
      );
      return { kind: 'unauthorized' };
    }

    const payload = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const rawFields = (
      payload.fields && typeof payload.fields === 'object' ? payload.fields : {}
    ) as Record<string, unknown>;
    const fields = Object.fromEntries(
      intention.fields.map((field) => [field.jsonName, text(rawFields[field.jsonName])]),
    );
    const chat = text(payload.chat);
    const dialogId = chat ? dialogFromChat(chat, intention.tenantId) : null;
    const contact = (
      payload.contact && typeof payload.contact === 'object' ? payload.contact : {}
    ) as Record<string, unknown>;

    const started = Date.now();
    const record = async (status: 'SUCCESS' | 'FAILED' | 'REJECTED', reply: IntentionReply) => {
      await this.db.insert(intentionExecution).values({
        tenantId: intention.tenantId,
        intentionId: intention.id,
        status,
        fields,
        dialogId,
        message: reply.message,
        results: reply.results,
        durationMs: Date.now() - started,
      });
      return { kind: 'reply' as const, reply };
    };

    if (intention.deletedAt || !intention.active) {
      return record('REJECTED', {
        ok: false,
        message: 'Esta ação está desativada no momento. Diga ao cliente que a equipe vai ajudar.',
        results: [],
      });
    }
    if (row.tenantStatus !== 'ACTIVE') {
      return record('REJECTED', {
        ok: false,
        message:
          'Não foi possível acessar o CRM agora. Diga ao cliente que a equipe vai dar continuidade.',
        results: [],
      });
    }

    const dedupeKey = `intention:run:${createHash('sha256')
      .update(JSON.stringify([intention.id, chat, Object.entries(fields).sort()]))
      .digest('hex')}`;
    const cached = await this.redis.get(dedupeKey);
    if (cached) return { kind: 'reply', reply: JSON.parse(cached) as IntentionReply };

    const template: TemplateContext = {
      contact: { name: text(contact.name) || null, phone: text(contact.phone) || null },
      message: { text: null, role: null },
      agent: { id: intention.agentId, name: row.agentName },
      event: { name: 'intention', date: new Date(started).toISOString() },
      dialog: { id: dialogId },
      interaction: { id: null, protocol: null },
      payload: body,
      fields,
    };
    const results: IntentionReply['results'] = [];
    for (const [index, action] of intention.actions.entries()) {
      try {
        if (action.type === 'TRANSFER_TO_HUMAN') {
          // Agendada: o canal transfere depois de entregar a resposta que o agente está montando.
          if (!dialogId) throw new Error('conversa do Bitrix não identificada na chamada');
          const userId = (action.config as { userId?: number }).userId;
          await this.handoffs.schedule(intention.tenantId, dialogId, {
            agentId: intention.agentId,
            ...(userId ? { userId } : {}),
          });
          results.push({ type: action.type, ok: true, result: { scheduled: true } });
          continue;
        }
        const result = await this.executor.execute(
          { ...(action as ExecutableAction), id: `${intention.id}:${index}`, secret: null },
          {
            installationId: Number(row.installationId),
            agentEventId: `${intention.id}:${started}`,
            dialogId,
            template,
          },
        );
        results.push({ type: action.type, ok: true, result });
      } catch (error) {
        const message =
          error instanceof ActionError || error instanceof Error ? error.message : String(error);
        results.push({ type: action.type, ok: false, error: message.slice(0, 500) });
        this.logger.warn(
          { intentionId: intention.id, action: action.type, err: error },
          'ação da intenção falhou',
        );
      }
    }
    const ok = results.every((r) => r.ok);
    const reply: IntentionReply = { ok, message: summarize(results), results };
    await this.redis.set(dedupeKey, JSON.stringify(reply), 'EX', DEDUPE_SECONDS);
    return record(ok ? 'SUCCESS' : 'FAILED', reply);
  }
}
