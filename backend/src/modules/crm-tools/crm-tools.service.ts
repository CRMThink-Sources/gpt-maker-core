import { Inject, Injectable } from '@nestjs/common';
import { DEAL_PIPELINE_FIELD, DEAL_STAGE_FIELD } from '@gptmaker/contracts';
import type Redis from 'ioredis';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { DB, type Database } from '../../shared/database/database.module';
import { REDIS } from '../../shared/redis/redis.module';
import { isTestDialog, testDialogKeyFrom, TestConversations } from '../agent-test';
import { BitrixClient, BitrixError } from '../bitrix';
import { dialogFromChat } from '../intentions';
import {
  FieldCatalogService,
  FieldSettingsService,
  type SemanticValue,
  stageOf,
  translateRecord,
  type TranslationContext,
  userIdsIn,
  UserNamesService,
} from '../semantic';
import { parseCrmBinding } from '../triggers';
import { ClientRefs, type ClientType } from './client-ref';
import { composeGuidance } from './crm-guidance.defaults';
import { CrmGuidanceService } from './crm-guidance.service';
import type { CrmCaller } from './crm-access.guard';
import { ToolRunner, type ToolResult } from './tool-runner';

// Os tipos e o tempo máximo moraram aqui; seguem exportados para quem já importa deste arquivo.
export { TOOL_TIMEOUT_MS, type ToolName, type ToolOutcome, type ToolResult } from './tool-runner';

export type DealSituation = 'em_andamento' | 'ganhos' | 'perdidos' | 'todos';
export const DEAL_SITUATIONS: readonly DealSituation[] = [
  'em_andamento',
  'ganhos',
  'perdidos',
  'todos',
];
const SEMANTIC_FILTER: Record<DealSituation, string | null> = {
  em_andamento: 'P',
  ganhos: 'S',
  perdidos: 'F',
  todos: null,
};

/** Negócios por resposta (spec agent-crm-tools). */
export const MAX_DEALS = 10;

const CLIENT_TYPE_LABEL: Record<ClientType, string> = {
  contact: 'contato',
  lead: 'lead',
  company: 'empresa',
};
/** Campos entregues à parte, fora da lista `campos`. */
const DEAL_BASE = ['ID', 'TITLE', 'CATEGORY_ID', 'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID'];
const DEAL_DATES = ['DATE_CREATE', 'CLOSEDATE'];
const OMIT_DEAL = new Set([
  'TITLE',
  'OPPORTUNITY',
  'CURRENCY_ID',
  'DATE_CREATE',
  'CLOSEDATE',
  DEAL_PIPELINE_FIELD,
  DEAL_STAGE_FIELD,
]);
const OMIT_CLIENT = new Set(['NAME', 'SECOND_NAME', 'LAST_NAME', 'TITLE', 'ASSIGNED_BY_ID']);

/**
 * Ferramentas somente leitura do agente sobre o CRM (spec agent-crm-tools, design S2/S7): a
 * intenção de sistema identifica o cliente pelo vínculo da conversa; o MCP lista negócios e
 * etapas a partir da referência assinada. Toda saída passa pela camada semântica.
 */
@Injectable()
export class CrmToolsService {
  readonly refs: ClientRefs;
  private readonly runner: ToolRunner;

  constructor(
    private readonly bitrix: BitrixClient,
    private readonly catalog: FieldCatalogService,
    private readonly settings: FieldSettingsService,
    private readonly users: UserNamesService,
    @Inject(DB) db: Database,
    @Inject(REDIS) redis: Redis,
    @Inject(ENV) env: Env,
    private readonly testConversations: TestConversations,
    private readonly guidance: CrmGuidanceService,
  ) {
    this.refs = ClientRefs.fromBase64Key(env.DATA_ENCRYPTION_KEY);
    this.runner = new ToolRunner(db, redis, env);
  }

  /** Intenção "Consultar cliente no CRM": só pelo vínculo da conversa, nunca por dado digitado. */
  identifyClient(caller: CrmCaller, chat: unknown): Promise<ToolResult> {
    return this.runner.run(caller, 'consultar_cliente', async () => {
      const dialogId =
        typeof chat === 'string' && !/\{\{/.test(chat)
          ? dialogFromChat(chat, caller.tenantId)
          : null;
      if (!dialogId) return this.notIdentified();

      const client = await this.conversationClient(caller, dialogId);
      if (!client) return this.notIdentified();

      const ctx = await this.context(caller);
      const record = await this.getRecord(caller, client.type, client.id);
      if (!record) return this.notIdentified();
      const deals = await this.listDeals(caller, client, 'em_andamento', ctx);
      const company = await this.companyName(caller, client.type, record);
      const names = await this.users.resolve(caller, [
        ...userIdsIn(client.type, [record], ctx),
        ...userIdsIn('deal', deals.rows, ctx),
        ...[record.ASSIGNED_BY_ID, ...deals.rows.map((deal) => deal.ASSIGNED_BY_ID)]
          .filter((id) => id !== undefined && id !== null)
          .map(String),
      ]);
      const full = { ...ctx, users: names };
      const guidance = await this.guidance.current();

      return {
        outcome: 'ok',
        count: 1 + deals.rows.length,
        body: {
          cliente: {
            tipo: CLIENT_TYPE_LABEL[client.type],
            referencia: this.refs.issue(caller.tenantId, client.type, client.id),
            nome: displayName(client.type, record),
            ...(company ? { empresa: company } : {}),
            ...(names.get(String(record.ASSIGNED_BY_ID))
              ? { responsavel: names.get(String(record.ASSIGNED_BY_ID)) }
              : {}),
            campos: translateRecord(client.type, record, full, OMIT_CLIENT),
          },
          negocios_em_andamento: deals.rows.map((deal) => this.dealView(deal, full)),
          ha_mais_negocios: deals.more,
          orientacao: composeGuidance(guidance, 'cliente_identificado'),
        },
      };
    });
  }

  clientDeals(caller: CrmCaller, ref: unknown, situation: DealSituation = 'todos') {
    return this.runner.run(caller, 'negocios_do_cliente', async () => {
      const client = this.refs.verify(caller.tenantId, ref);
      if (!client)
        return notFound(
          'Cliente não encontrado. Use a referência devolvida por "Consultar cliente no CRM".',
        );
      const ctx = await this.context(caller);
      const deals = await this.listDeals(caller, client, situation, ctx);
      const names = await this.users.resolve(caller, userIdsIn('deal', deals.rows, ctx));
      const full = { ...ctx, users: names };
      const guidance = await this.guidance.current();
      return {
        outcome: 'ok',
        count: deals.rows.length,
        body: {
          situacao: situation,
          negocios: deals.rows.map((deal) => this.dealView(deal, full)),
          ha_mais: deals.more,
          ...(deals.more ? { total: deals.total } : {}),
          orientacao: composeGuidance(guidance, 'negocios_do_cliente'),
        },
      };
    });
  }

  /**
   * Cliente da referência para as ferramentas de agenda (spec agent-calendar-scheduling): tipo, id,
   * nome e responsável (`ASSIGNED_BY_ID`). Referência inválida, adulterada ou de outro tenant, ou
   * registro apagado, contam como cliente não encontrado. Não passa pelo executor das ferramentas:
   * quem chama já está dentro dele.
   */
  async calendarClient(
    caller: CrmCaller,
    ref: unknown,
  ): Promise<
    | { found: false }
    | { found: true; type: ClientType; id: number; name: string | null; userId: number | null }
  > {
    const client = this.refs.verify(caller.tenantId, ref);
    if (!client) return { found: false };
    const record = await this.getRecord(caller, client.type, client.id);
    if (!record) return { found: false };
    const userId = Number(record.ASSIGNED_BY_ID);
    return {
      found: true,
      type: client.type,
      id: client.id,
      name: displayName(client.type, record),
      userId: userId > 0 ? userId : null,
    };
  }

  pipelineStages(caller: CrmCaller, pipelineName?: string) {
    return this.runner.run(caller, 'etapas_do_funil', async () => {
      const [metadata, choices] = await Promise.all([
        this.catalog.load(caller),
        this.settings.forTenant(caller.tenantId),
      ]);
      // Funil ou etapa escondidos pela empresa: os funis também não são mostrados.
      if (
        !choices.exposed('deal', DEAL_PIPELINE_FIELD) ||
        !choices.exposed('deal', DEAL_STAGE_FIELD)
      ) {
        return {
          outcome: 'not_found',
          count: 0,
          body: { erro: 'Os funis e as etapas não estão liberados para consulta.' },
        };
      }
      const wanted = pipelineName?.trim() ? normalize(pipelineName) : null;
      const pipelines = wanted
        ? metadata.pipelines.filter((pipeline) => normalize(pipeline.name) === wanted)
        : metadata.pipelines;
      if (!pipelines.length) {
        return {
          outcome: 'not_found',
          count: 0,
          body: {
            erro: 'Funil não encontrado.',
            funis_existentes: metadata.pipelines.map((pipeline) => pipeline.name),
          },
        };
      }
      return {
        outcome: 'ok',
        count: pipelines.length,
        body: {
          funis: pipelines.map((pipeline) => ({
            funil: pipeline.name,
            etapas: pipeline.stages.map((stage) => ({
              etapa: stage.name,
              situacao: stageOf(metadata.pipelines, pipeline.id, stage.id)!.situacao,
            })),
          })),
        },
      };
    });
  }

  private async notIdentified(): Promise<ToolResult> {
    const guidance = await this.guidance.current();
    return {
      outcome: 'not_identified',
      count: 0,
      body: { cliente: null, mensagem: guidance.cliente_nao_identificado },
    };
  }

  private async context(caller: CrmCaller): Promise<Omit<TranslationContext, 'users'>> {
    const [metadata, choices] = await Promise.all([
      this.catalog.load(caller),
      this.settings.forTenant(caller.tenantId),
    ]);
    return { metadata, choices };
  }

  /**
   * Cliente da conversa: na de teste, o simulado pelo testador (só do tenant da credencial); na
   * Linha Aberta, o vínculo do diálogo no Bitrix24.
   */
  private async conversationClient(
    caller: CrmCaller,
    dialogId: string,
  ): Promise<{ type: ClientType; id: number } | null> {
    if (isTestDialog(dialogId)) {
      const key = testDialogKeyFrom(dialogId);
      return key ? this.testConversations.simulatedClient(caller.tenantId, key) : null;
    }
    const { result } = await this.bitrix.call<{ entity_data_2?: unknown }>(
      caller.installationId,
      'imopenlines.dialog.get',
      { DIALOG_ID: dialogId },
    );
    return this.clientOf(caller, parseCrmBinding(result?.entity_data_2));
  }

  /** Contato, depois lead, depois empresa; só negócio vinculado ⇒ contato ou empresa dele. */
  private async clientOf(
    caller: CrmCaller,
    binding: ReturnType<typeof parseCrmBinding>,
  ): Promise<{ type: ClientType; id: number } | null> {
    if (binding.contact) return { type: 'contact', id: binding.contact };
    if (binding.lead) return { type: 'lead', id: binding.lead };
    if (binding.company) return { type: 'company', id: binding.company };
    if (!binding.deal) return null;
    const deal = await this.getRecord(caller, 'deal', binding.deal);
    const contactId = Number(deal?.CONTACT_ID);
    if (contactId > 0) return { type: 'contact', id: contactId };
    const companyId = Number(deal?.COMPANY_ID);
    return companyId > 0 ? { type: 'company', id: companyId } : null;
  }

  private async getRecord(
    caller: CrmCaller,
    type: ClientType | 'deal',
    id: number,
  ): Promise<Record<string, unknown> | null> {
    try {
      const { result } = await this.bitrix.call<Record<string, unknown>>(
        caller.installationId,
        `crm.${type}.get`,
        { id },
      );
      return result ?? null;
    } catch (error) {
      // Registro apagado ou sem acesso: o cliente não está mais no CRM.
      if (error instanceof BitrixError && error.kind === 'API_ERROR') return null;
      throw error;
    }
  }

  private async companyName(
    caller: CrmCaller,
    type: ClientType,
    record: Record<string, unknown>,
  ): Promise<string | null> {
    if (type === 'company') return null;
    if (type === 'lead') return text(record.COMPANY_TITLE);
    const companyId = Number(record.COMPANY_ID);
    if (!(companyId > 0)) return null;
    const company = await this.getRecord(caller, 'company', companyId);
    return text(company?.TITLE);
  }

  private async listDeals(
    caller: CrmCaller,
    client: { type: ClientType; id: number },
    situation: DealSituation,
    ctx: Omit<TranslationContext, 'users'>,
  ): Promise<{ rows: Array<Record<string, unknown>>; more: boolean; total: number }> {
    const owner = { contact: 'CONTACT_ID', lead: 'LEAD_ID', company: 'COMPANY_ID' }[client.type];
    const semantic = SEMANTIC_FILTER[situation];
    const exposed = ctx.metadata.fields.deal
      .filter((field) => ctx.choices.exposed('deal', field.code))
      .map((field) => field.code);
    const { result, total } = await this.bitrix.call<Array<Record<string, unknown>>>(
      caller.installationId,
      'crm.deal.list',
      {
        filter: { [owner]: client.id, ...(semantic ? { STAGE_SEMANTIC_ID: semantic } : {}) },
        order: { DATE_CREATE: 'DESC' },
        select: [...new Set([...DEAL_BASE, ...DEAL_DATES, 'ASSIGNED_BY_ID', ...exposed])],
      },
    );
    const rows = (Array.isArray(result) ? result : []).slice(0, MAX_DEALS);
    const count = total ?? rows.length;
    return { rows, more: count > rows.length, total: count };
  }

  private dealView(deal: Record<string, unknown>, ctx: TranslationContext) {
    const stage = stageOf(ctx.metadata.pipelines, deal.CATEGORY_ID, deal.STAGE_ID);
    // A situação (ganha, perdida, em andamento) vem da etapa: some junto com ela.
    const showPipeline = ctx.choices.exposed('deal', DEAL_PIPELINE_FIELD);
    const showStage = ctx.choices.exposed('deal', DEAL_STAGE_FIELD);
    const amount = text(deal.OPPORTUNITY);
    const currency = text(deal.CURRENCY_ID);
    return {
      titulo: text(deal.TITLE) ?? 'Negócio sem título',
      ...(stage && showPipeline ? { funil: stage.funil } : {}),
      ...(stage && showStage ? { etapa: stage.etapa, situacao: stage.situacao } : {}),
      // Sem valor, diz isso: omitir fazia o agente prometer buscar o valor.
      valor:
        amount && Number(amount) > 0
          ? currency
            ? `${amount} ${currency}`
            : amount
          : 'não informado',
      ...(text(deal.DATE_CREATE) ? { criado_em: text(deal.DATE_CREATE) } : {}),
      ...(text(deal.CLOSEDATE) ? { fechamento_previsto: dateOnly(text(deal.CLOSEDATE)!) } : {}),
      campos: translateRecord('deal', deal, ctx, OMIT_DEAL) satisfies SemanticValue[],
    };
  }
}

function notFound(message: string): ToolResult {
  return { outcome: 'not_found', count: 0, body: { erro: message } };
}

function displayName(type: ClientType, record: Record<string, unknown>): string {
  const person = [record.NAME, record.SECOND_NAME, record.LAST_NAME]
    .map(text)
    .filter(Boolean)
    .join(' ');
  if (type === 'company') return text(record.TITLE) ?? 'Empresa sem nome';
  return person || text(record.TITLE) || 'Cliente sem nome';
}

/** Campo só de data: o Bitrix manda meia-noite com fuso (`2026-10-19T03:00:00+03:00`); fica `2026-10-19`. */
function dateOnly(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
}

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Sem acento e sem caixa, para casar o nome do funil dito pelo agente. */
function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
