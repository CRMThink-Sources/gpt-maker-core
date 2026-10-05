import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type IntentionExecutionView,
  type IntentionInput,
  intentionInputSchema,
  intentionJsonName,
  type IntentionView,
} from '@gptmaker/contracts';
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { currentContext } from '../../shared/context/request-context';
import { fieldCipher } from '../../shared/crypto/field-cipher';
import { DB, type Database } from '../../shared/database/database.module';
import { agentIntention, intentionExecution } from '../../shared/database/schema/index';
import { DomainError } from '../../shared/http/api-exception.filter';
import { DistributedLock } from '../../shared/redis/distributed-lock';
import { REDIS } from '../../shared/redis/redis.module';
import {
  type Agent,
  type AgentChange,
  type AgentChangeListener,
  AgentEvents,
  AgentRepository,
} from '../agents';
import {
  collectAllPages,
  GptMakerClient,
  GptMakerError,
  type GptMakerIntention,
  type GptMakerWriteIntention,
} from '../gptmaker';

type Intention = typeof agentIntention.$inferSelect;
type Input = ReturnType<typeof intentionInputSchema.parse>;

const LOCK_TTL_MS = 60_000;
const LOCK_WAIT_MS = 20_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

const notFound = () =>
  new DomainError('INTENTION_NOT_FOUND', 'Intenção não encontrada', HttpStatus.NOT_FOUND);

const sameName = (a: string | null | undefined, b: string) =>
  (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

/** Cabeçalho com o token da intenção `BITRIX` (o endpoint do app confere). */
export const INTENTION_TOKEN_HEADER = 'X-Intention-Token';

/**
 * Corpo que o GPTMaker manda ao endpoint do app numa intenção `BITRIX`: os campos coletados e,
 * se o GPTMaker preencher, o chat (que leva o diálogo do Bitrix) e o contato.
 */
export function bitrixRequestBody(fields: Intention['fields']): string {
  return JSON.stringify({
    fields: Object.fromEntries(fields.map((field) => [field.jsonName, `{{${field.jsonName}}}`])),
    chat: '{{chat_id}}',
    contact: { name: '{{contact_name}}', phone: '{{contact_phone}}' },
  });
}

/** Corpo do GPTMaker a partir do registro local (cabeçalhos e token já decifrados). */
export function toRemote(row: Intention, publicUrl: string): GptMakerWriteIntention {
  const cipher = fieldCipher();
  const common = {
    description: row.name,
    details: row.whenToUse,
    manualOutput: row.responseMode === 'INSTRUCTIONS',
    ...(row.responseMode === 'INSTRUCTIONS' && row.instructions
      ? { instructions: row.instructions }
      : {}),
    type: 'WEBHOOK' as const,
    // Sem descrição, o nome orienta o agente sobre o que perguntar.
    fields: row.fields.map((field) => ({
      ...field,
      description: field.description.trim() || field.name,
    })),
    preprocessingMessage: 'DISABLED' as const,
    active: row.active,
  };
  if (row.kind === 'BITRIX') {
    return {
      ...common,
      httpMethod: 'POST',
      url: `${publicUrl.replace(/\/+$/, '')}/gptmaker/intentions/${row.id}`,
      headers: [
        {
          name: INTENTION_TOKEN_HEADER,
          value: row.tokenEncrypted ? cipher.decrypt(row.tokenEncrypted) : '',
        },
      ],
      params: [],
      requestBody: bitrixRequestBody(row.fields),
      autoGenerateParams: false,
      autoGenerateBody: false,
    };
  }
  return {
    ...common,
    httpMethod: row.httpMethod,
    url: row.url,
    headers: row.headers.map((header) => ({
      name: header.name,
      value: header.valueEncrypted ? cipher.decrypt(header.valueEncrypted) : '',
    })),
    params: row.params,
    ...(row.httpMethod === 'POST' && row.body && !row.autoGenerateBody
      ? { requestBody: row.body }
      : {}),
    autoGenerateParams: row.autoGenerateParams,
    autoGenerateBody: row.autoGenerateBody,
  };
}

function toView(row: Intention): IntentionView {
  return {
    id: row.id,
    kind: row.kind,
    actions: row.actions as IntentionView['actions'],
    name: row.name,
    whenToUse: row.whenToUse,
    fields: row.fields,
    httpMethod: row.httpMethod,
    url: row.url,
    headers: row.headers.map((header) => ({
      name: header.name,
      hasValue: header.valueEncrypted !== null,
    })),
    params: row.params,
    body: row.body,
    autoGenerateParams: row.autoGenerateParams,
    autoGenerateBody: row.autoGenerateBody,
    responseMode: row.responseMode,
    instructions: row.instructions,
    active: row.active,
    synced: row.gptmakerIntentionId !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Intenções dos agentes do tenant (spec agent-intentions, design D21): o agente coleta os campos,
 * chama a API configurada e responde. Criadas primeiro no GPTMaker (a criação não devolve o id,
 * que vem da listagem pelo nome) e depois localmente; alterações do mesmo agente são serializadas
 * para a busca do id não confundir duas intenções novas.
 */
@Injectable()
export class IntentionService implements OnModuleInit, AgentChangeListener {
  readonly name = 'intentions';
  private readonly logger = new Logger(IntentionService.name);
  private readonly lock: DistributedLock;

  constructor(
    private readonly agents: AgentRepository,
    private readonly gptmaker: GptMakerClient,
    private readonly agentEvents: AgentEvents,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.lock = new DistributedLock(redis);
  }

  private remote(row: Intention): GptMakerWriteIntention {
    return toRemote(row, this.env.API_PUBLIC_URL);
  }

  onModuleInit(): void {
    this.agentEvents.register(this);
  }

  /** Agente removido: as intenções somem com ele no GPTMaker; aqui, só a marca. */
  async onAgentChanged(change: AgentChange): Promise<void> {
    if (change.kind !== 'removed') return;
    await this.db
      .update(agentIntention)
      .set({ deletedAt: new Date() })
      .where(and(eq(agentIntention.agentId, change.agentId), isNull(agentIntention.deletedAt)));
  }

  async list(tenantId: string, agentId: string): Promise<IntentionView[]> {
    const owner = await this.agents.getById(tenantId, agentId);
    let rows = await this.rowsOf(owner);
    // Criada sem id (listagem do GPTMaker falhou na hora): tenta localizar agora.
    if (rows.some((row) => row.gptmakerIntentionId === null) && owner.status !== 'OUT_OF_SYNC') {
      try {
        await this.withAgentLock(owner.id, () => this.resolvePending(owner));
        rows = await this.rowsOf(owner);
      } catch (error) {
        this.logger.warn({ agentId: owner.id, err: error }, 'ids das intenções ainda pendentes');
      }
    }
    return rows.map(toView);
  }

  async create(tenantId: string, agentId: string, raw: IntentionInput): Promise<IntentionView> {
    const input = intentionInputSchema.parse(raw);
    const owner = await this.editableAgent(tenantId, agentId);
    return this.withAgentLock(owner.id, async () => {
      await this.assertUniqueName(owner, input.name);
      const id = randomUUID();
      const values = this.values(input, [], null);
      const remote = this.remote({ ...this.blank(owner), ...values, id });
      const known = await this.knownIds(owner);
      let gptmakerIntentionId = await this.callGptMaker(() =>
        this.gptmaker.createIntention(owner.gptmakerAgentId, remote),
      );

      // Resposta sem id (formato antigo da API): localiza pela listagem.
      if (!gptmakerIntentionId) {
        try {
          gptmakerIntentionId = await this.findCreated(owner, input.name, known);
        } catch (error) {
          this.logger.warn(
            { agentId: owner.id, err: error },
            'intenção criada no GPTMaker sem id local; a próxima leitura localiza',
          );
        }
      }
      const [row] = await this.db
        .insert(agentIntention)
        .values({ ...values, id, tenantId: owner.tenantId, agentId: owner.id, gptmakerIntentionId })
        .returning();
      return toView(row!);
    });
  }

  async update(
    tenantId: string,
    agentId: string,
    id: string,
    raw: IntentionInput,
  ): Promise<IntentionView> {
    const input = intentionInputSchema.parse(raw);
    const owner = await this.editableAgent(tenantId, agentId);
    return this.withAgentLock(owner.id, async () => {
      const current = await this.rowOf(owner, id);
      if (!sameName(current.name, input.name)) await this.assertUniqueName(owner, input.name, id);
      const gptmakerIntentionId = await this.remoteIdOf(owner, current);
      const values = this.values(input, current.headers, current.tokenEncrypted);
      await this.callGptMaker(() =>
        this.gptmaker.updateIntention(gptmakerIntentionId, this.remote({ ...current, ...values })),
      );
      const [row] = await this.db
        .update(agentIntention)
        .set({ ...values, gptmakerIntentionId })
        .where(eq(agentIntention.id, current.id))
        .returning();
      return toView(row!);
    });
  }

  /** Execuções recentes de uma intenção `BITRIX` (histórico da tela). */
  async executions(
    tenantId: string,
    agentId: string,
    id: string,
  ): Promise<IntentionExecutionView[]> {
    const owner = await this.agents.getById(tenantId, agentId);
    const row = await this.rowOf(owner, id);
    const rows = await this.db
      .select()
      .from(intentionExecution)
      .where(eq(intentionExecution.intentionId, row.id))
      .orderBy(desc(intentionExecution.createdAt))
      .limit(30);
    return rows.map((execution) => ({
      id: execution.id,
      createdAt: execution.createdAt.toISOString(),
      status: execution.status,
      fields: execution.fields,
      dialogId: execution.dialogId,
      message: execution.message,
      results: execution.results,
      durationMs: execution.durationMs,
    }));
  }

  /** Ausente no GPTMaker conta como removida. */
  async remove(tenantId: string, agentId: string, id: string): Promise<void> {
    const owner = await this.agents.getById(tenantId, agentId);
    await this.withAgentLock(owner.id, async () => {
      const current = await this.rowOf(owner, id);
      const remoteId =
        current.gptmakerIntentionId ??
        (owner.status === 'OUT_OF_SYNC'
          ? null
          : await this.findCreated(owner, current.name, await this.knownIds(owner)));
      if (remoteId) {
        await this.callGptMaker(async () => {
          try {
            await this.gptmaker.deleteIntention(remoteId);
          } catch (error) {
            if (!(error instanceof GptMakerError && error.kind === 'NOT_FOUND')) throw error;
          }
        });
      }
      await this.db
        .update(agentIntention)
        .set({ deletedAt: new Date() })
        .where(eq(agentIntention.id, current.id));
    });
  }

  /** Valores locais do formulário; cabeçalho com valor `null` mantém o gravado (mesmo nome). */
  private values(
    input: Input,
    previous: Intention['headers'],
    previousToken: string | null,
  ): Omit<typeof agentIntention.$inferInsert, 'tenantId' | 'agentId'> {
    const cipher = fieldCipher();
    const bitrix = input.kind === 'BITRIX';
    return {
      kind: input.kind,
      actions: bitrix ? input.actions : [],
      // Token mantido entre edições: a intenção no GPTMaker continua valendo.
      tokenEncrypted: bitrix
        ? (previousToken ?? cipher.encrypt(randomBytes(32).toString('base64url')))
        : null,
      name: input.name,
      whenToUse: input.whenToUse,
      fields: input.fields.map((field) => ({
        name: field.name,
        jsonName: intentionJsonName(field.name),
        description: field.description,
        type: field.type,
        required: field.required,
      })),
      httpMethod: bitrix ? 'POST' : input.httpMethod,
      url: bitrix ? '' : input.url,
      headers: (bitrix ? [] : input.headers).map((header) => ({
        name: header.name,
        valueEncrypted:
          header.value === null
            ? (previous.find((old) => old.name === header.name)?.valueEncrypted ?? null)
            : cipher.encrypt(header.value),
      })),
      params: bitrix ? [] : input.params,
      body: !bitrix && input.httpMethod === 'POST' && input.body?.trim() ? input.body : null,
      autoGenerateParams: !bitrix && input.autoGenerateParams,
      autoGenerateBody: !bitrix && input.httpMethod === 'POST' && input.autoGenerateBody,
      responseMode: input.responseMode,
      instructions: input.responseMode === 'INSTRUCTIONS' ? input.instructions : null,
      active: input.active,
    };
  }

  /** Linha local de rascunho só para montar o corpo do GPTMaker na criação. */
  private blank(owner: Agent): Intention {
    const now = new Date();
    return {
      id: '',
      tenantId: owner.tenantId,
      agentId: owner.id,
      gptmakerIntentionId: null,
      kind: 'WEBHOOK',
      actions: [],
      tokenEncrypted: null,
      name: '',
      whenToUse: '',
      fields: [],
      httpMethod: 'GET',
      url: '',
      headers: [],
      params: [],
      body: null,
      autoGenerateParams: false,
      autoGenerateBody: false,
      responseMode: 'API',
      instructions: null,
      active: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  }

  private rowsOf(owner: Agent): Promise<Intention[]> {
    return this.db
      .select()
      .from(agentIntention)
      .where(and(eq(agentIntention.agentId, owner.id), isNull(agentIntention.deletedAt)))
      .orderBy(asc(agentIntention.createdAt), asc(agentIntention.id));
  }

  private async rowOf(owner: Agent, id: string): Promise<Intention> {
    if (!/^[\da-f-]{36}$/i.test(id)) throw notFound();
    const [row] = await this.db
      .select()
      .from(agentIntention)
      .where(
        and(
          eq(agentIntention.id, id),
          eq(agentIntention.agentId, owner.id),
          isNull(agentIntention.deletedAt),
        ),
      );
    if (!row) throw notFound();
    return row;
  }

  private async assertUniqueName(owner: Agent, name: string, except?: string): Promise<void> {
    const [taken] = await this.db
      .select({ id: agentIntention.id })
      .from(agentIntention)
      .where(
        and(
          eq(agentIntention.agentId, owner.id),
          isNull(agentIntention.deletedAt),
          sql`lower(${agentIntention.name}) = lower(${name.trim()})`,
          except ? ne(agentIntention.id, except) : undefined,
        ),
      );
    if (taken) {
      throw new DomainError(
        'INTENTION_NAME_TAKEN',
        'Este agente já tem uma intenção com esse nome',
        HttpStatus.CONFLICT,
      );
    }
  }

  private async editableAgent(tenantId: string, agentId: string): Promise<Agent> {
    const owner = await this.agents.getById(tenantId, agentId);
    if (owner.status === 'OUT_OF_SYNC') {
      throw new DomainError(
        'AGENT_OUT_OF_SYNC',
        'O agente não foi encontrado no GPTMaker; fale com o suporte',
        HttpStatus.CONFLICT,
      );
    }
    return owner;
  }

  /** Ids do GPTMaker já ligados a intenções locais do agente (inclusive removidas). */
  private async knownIds(owner: Agent): Promise<Set<string>> {
    const rows = await this.db
      .select({ id: agentIntention.gptmakerIntentionId })
      .from(agentIntention)
      .where(
        and(eq(agentIntention.agentId, owner.id), isNotNull(agentIntention.gptmakerIntentionId)),
      );
    return new Set(rows.map((row) => row.id!));
  }

  private remoteIntentions(owner: Agent): Promise<GptMakerIntention[]> {
    return collectAllPages(
      (page, pageSize) => this.gptmaker.listIntentions(owner.gptmakerAgentId, { page, pageSize }),
      PAGE_SIZE,
      MAX_PAGES,
    );
  }

  /** Intenção do GPTMaker ainda sem dono local com esse nome. */
  private async findCreated(
    owner: Agent,
    name: string,
    known: Set<string>,
  ): Promise<string | null> {
    const remote = await this.remoteIntentions(owner);
    return (
      remote.find((item) => !known.has(item.id) && sameName(item.description, name))?.id ?? null
    );
  }

  private async resolvePending(owner: Agent): Promise<void> {
    const pending = (await this.rowsOf(owner)).filter((row) => row.gptmakerIntentionId === null);
    if (!pending.length) return;
    const known = await this.knownIds(owner);
    const remote = await this.remoteIntentions(owner);
    for (const row of pending) {
      const found = remote.find(
        (item) => !known.has(item.id) && sameName(item.description, row.name),
      );
      if (!found) continue;
      known.add(found.id);
      await this.db
        .update(agentIntention)
        .set({ gptmakerIntentionId: found.id })
        .where(eq(agentIntention.id, row.id));
    }
  }

  private async remoteIdOf(owner: Agent, row: Intention): Promise<string> {
    if (row.gptmakerIntentionId) return row.gptmakerIntentionId;
    const found = await this.callGptMaker(async () =>
      this.findCreated(owner, row.name, await this.knownIds(owner)),
    );
    if (found) return found;
    throw new DomainError(
      'INTENTION_NOT_SYNCED',
      'A intenção ainda não foi localizada no GPTMaker. Tente de novo em instantes',
      HttpStatus.CONFLICT,
    );
  }

  /** Espera a vez em vez de recusar: várias intenções seguidas do mesmo agente são comuns. */
  private async withAgentLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      const outcome = await this.lock.runExclusive(`intention:${agentId}`, LOCK_TTL_MS, fn);
      if (outcome.ran) return outcome.result;
      if (Date.now() > deadline) {
        throw new DomainError(
          'INTENTION_BUSY',
          'Outra intenção deste agente está sendo salva; tente de novo em instantes',
          HttpStatus.CONFLICT,
        );
      }
      await sleep(250);
    }
  }

  /** Falha do GPTMaker vira erro recuperável com o `traceId` para o suporte localizar o log. */
  private async callGptMaker<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof GptMakerError)) throw error;
      const traceId = currentContext()?.traceId;
      this.logger.error(
        { traceId, operation: error.operation, kind: error.kind, err: error },
        'falha no GPTMaker',
      );
      if (error.kind === 'VALIDATION') {
        throw new DomainError(
          'GPTMAKER_REJECTED',
          'O GPTMaker recusou a intenção. Revise os dados e tente de novo',
          HttpStatus.UNPROCESSABLE_ENTITY,
          { traceId, reason: error.message },
        );
      }
      throw new DomainError(
        'GPTMAKER_UNAVAILABLE',
        'Não foi possível salvar a intenção no GPTMaker agora. Tente de novo em instantes',
        HttpStatus.SERVICE_UNAVAILABLE,
        { traceId },
      );
    }
  }
}
