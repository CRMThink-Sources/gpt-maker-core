import type {
  BatchCommand,
  BatchResult,
  BitrixClient,
  BitrixParams,
} from '../../src/modules/bitrix';
import { BitrixError } from '../../src/modules/bitrix';

type Row = Record<string, unknown>;

/**
 * Portal Bitrix24 em memória para testes da camada semântica e das ferramentas do CRM: responde
 * `crm.*.fields`, `crm.status.list`, `crm.category.list`, `user.get`, `crm.*.get`,
 * `crm.deal.list` e `imopenlines.dialog.get`, por `call` e por `batch`.
 */
export class FakeCrmPortal {
  readonly calls: Array<{ method: string; params: BitrixParams }> = [];
  /** Método ⇒ erro lançado (simula Bitrix fora do ar). */
  readonly failing = new Map<string, BitrixError>();

  fields: Record<string, Record<string, Row>> = {
    lead: {
      TITLE: { type: 'string', title: 'Nome do lead' },
      NAME: { type: 'string', title: 'Nome' },
      STATUS_ID: { type: 'crm_status', title: 'Status', statusType: 'STATUS' },
      ASSIGNED_BY_ID: { type: 'user', title: 'Responsável' },
      PHONE: { type: 'crm_multifield', title: 'Telefone', isMultiple: true },
    },
    deal: {
      ID: { type: 'integer', title: 'ID' },
      TITLE: { type: 'string', title: 'Nome do negócio' },
      CATEGORY_ID: { type: 'crm_category', title: 'Funil' },
      STAGE_ID: { type: 'crm_status', title: 'Etapa', statusType: 'DEAL_STAGE' },
      OPPORTUNITY: { type: 'double', title: 'Valor' },
      CURRENCY_ID: { type: 'crm_currency', title: 'Moeda' },
      ASSIGNED_BY_ID: { type: 'user', title: 'Responsável' },
      DATE_CREATE: { type: 'datetime', title: 'Criado em' },
      CLOSEDATE: { type: 'date', title: 'Data prevista de fechamento' },
      UF_CRM_MARGEM: { type: 'double', title: 'UF_CRM_MARGEM', formLabel: 'Margem interna' },
      UF_CRM_PLANO: {
        type: 'enumeration',
        title: 'UF_CRM_PLANO',
        formLabel: 'Plano contratado',
        items: [
          { ID: 10, VALUE: 'Básico' },
          { ID: 11, VALUE: 'Pro' },
        ],
      },
    },
    contact: {
      NAME: { type: 'string', title: 'Nome' },
      LAST_NAME: { type: 'string', title: 'Sobrenome' },
      COMPANY_ID: { type: 'crm_company', title: 'Empresa' },
      ASSIGNED_BY_ID: { type: 'user', title: 'Responsável' },
      PHONE: { type: 'crm_multifield', title: 'Telefone', isMultiple: true },
      EMAIL: { type: 'crm_multifield', title: 'E-mail', isMultiple: true },
      UF_CRM_ORIGEM: {
        type: 'enumeration',
        title: 'UF_CRM_ORIGEM',
        formLabel: 'Origem do lead',
        items: [
          { ID: 45, VALUE: 'Instagram' },
          { ID: 46, VALUE: 'Indicação' },
        ],
      },
      UF_CRM_VIP: { type: 'boolean', title: 'UF_CRM_VIP', formLabel: 'Cliente VIP' },
    },
    company: {
      TITLE: { type: 'string', title: 'Nome da empresa' },
      ASSIGNED_BY_ID: { type: 'user', title: 'Responsável' },
    },
  };

  categories: Row[] = [{ id: 3, name: 'Vendas B2B', sort: 200, isDefault: 'N' }];

  statuses: Record<string, Row[]> = {
    STATUS: [
      { STATUS_ID: 'NEW', NAME: 'Não tratado', SORT: 10 },
      { STATUS_ID: 'IN_PROCESS', NAME: 'Em atendimento', SORT: 20 },
    ],
    DEAL_STAGE: [
      { STATUS_ID: 'NEW', NAME: 'Novo', SORT: 10 },
      { STATUS_ID: 'WON', NAME: 'Ganho', SORT: 90, SEMANTICS: 'S' },
      { STATUS_ID: 'LOSE', NAME: 'Perdido', SORT: 100, SEMANTICS: 'F' },
    ],
    DEAL_STAGE_3: [
      { STATUS_ID: 'C3:NEW', NAME: 'Primeiro contato', SORT: 10 },
      { STATUS_ID: 'C3:PREPARATION', NAME: 'Proposta enviada', SORT: 20 },
      { STATUS_ID: 'C3:WON', NAME: 'Fechado', SORT: 90, SEMANTICS: 'S' },
      { STATUS_ID: 'C3:LOSE', NAME: 'Desistiu', SORT: 100, SEMANTICS: 'F' },
    ],
  };

  users: Record<string, Row> = {
    '7': { ID: '7', NAME: 'Ana', LAST_NAME: 'Vendas' },
  };

  records: Record<'lead' | 'deal' | 'contact' | 'company', Record<string, Row>> = {
    lead: {},
    deal: {},
    contact: {},
    company: {},
  };

  /** Diálogo da Linha Aberta ⇒ `entity_data_2` (`LEAD|id|COMPANY|id|CONTACT|id|DEAL|id`). */
  dialogs: Record<string, string> = {};

  asClient(): BitrixClient {
    return {
      call: async (_installationId: number, method: string, params: BitrixParams = {}) =>
        this.respond(method, params),
      batch: async (_installationId: number, commands: Record<string, BatchCommand>) => {
        const out: BatchResult = { results: {}, errors: {} };
        for (const [name, command] of Object.entries(commands)) {
          try {
            out.results[name] = (await this.respond(command.method, command.params ?? {})).result;
          } catch (error) {
            if (!(error instanceof BitrixError)) throw error;
            out.errors[name] = { error: error.code, error_description: error.message };
          }
        }
        return out;
      },
    } as unknown as BitrixClient;
  }

  count(method: string): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  private async respond(
    method: string,
    params: BitrixParams,
  ): Promise<{ result: unknown; total?: number }> {
    this.calls.push({ method, params });
    const failure = this.failing.get(method);
    if (failure) throw failure;

    const fieldsMatch = /^crm\.(lead|deal|contact|company)\.fields$/.exec(method);
    if (fieldsMatch) return { result: this.fields[fieldsMatch[1]!] ?? {} };

    const getMatch = /^crm\.(lead|deal|contact|company)\.get$/.exec(method);
    if (getMatch) {
      const record = this.records[getMatch[1] as 'lead'][String(params.id)];
      if (!record) throw new BitrixError('API_ERROR', method, 'NOT_FOUND', 'Not found');
      return { result: record };
    }

    switch (method) {
      case 'crm.category.list':
        return { result: { categories: this.categories } };
      case 'crm.status.list': {
        const entityId = (params.filter as { ENTITY_ID: string }).ENTITY_ID;
        return { result: this.statuses[entityId] ?? [] };
      }
      case 'user.get': {
        const user = this.users[String(params.ID)];
        return { result: user ? [user] : [] };
      }
      case 'imopenlines.dialog.get': {
        const data = this.dialogs[String(params.DIALOG_ID)];
        if (data === undefined) throw new BitrixError('API_ERROR', method, 'DIALOG_NOT_FOUND', '');
        return { result: { entity_data_2: data } };
      }
      case 'crm.deal.list':
        return this.listDeals(params);
      case 'crm.contact.list':
      case 'crm.lead.list':
      case 'crm.company.list':
        return this.listLike(method.split('.')[1] as 'contact' | 'lead' | 'company', params);
      case 'crm.duplicate.findbycomm':
        return { result: this.findByComm(params) };
      default:
        throw new Error(`FakeCrmPortal: método não simulado ${method}`);
    }
  }

  /** Listagem com filtro `%CAMPO` (contém, sem caixa), como a busca de clientes usa. */
  private listLike(entity: 'contact' | 'lead' | 'company', params: BitrixParams) {
    const filter = (params.filter ?? {}) as Record<string, string>;
    const rows = Object.values(this.records[entity]).filter((row) =>
      Object.entries(filter).every(([key, value]) => {
        const field = key.replace(/^%/, '');
        return String(row[field] ?? '')
          .toLowerCase()
          .includes(String(value).toLowerCase());
      }),
    );
    return { result: rows.slice(0, 50), total: rows.length };
  }

  /** `crm.duplicate.findbycomm`: ids por entidade com o telefone (dígitos) ou e-mail. */
  private findByComm(params: BitrixParams) {
    const type = String(params.type);
    const [wanted] = params.values as string[];
    const values = (row: Row) =>
      ((row[type] as Array<{ VALUE: string }> | undefined) ?? []).map((item) =>
        type === 'PHONE' ? item.VALUE.replace(/\D/g, '') : item.VALUE.toLowerCase(),
      );
    const found: Record<string, number[]> = {};
    for (const [entity, key] of [
      ['contact', 'CONTACT'],
      ['lead', 'LEAD'],
      ['company', 'COMPANY'],
    ] as const) {
      const ids = Object.values(this.records[entity])
        .filter((row) => values(row).some((value) => value.endsWith(wanted!)))
        .map((row) => Number(row.ID));
      if (ids.length) found[key] = ids;
    }
    // O Bitrix devolve `[]` quando não acha nada.
    return Object.keys(found).length ? found : [];
  }

  private listDeals(params: BitrixParams) {
    const filter = (params.filter ?? {}) as Record<string, unknown>;
    let rows = Object.values(this.records.deal).filter((deal) =>
      Object.entries(filter).every(([key, value]) => {
        const field = key.replace(/^[@=]+/, '');
        return Array.isArray(value)
          ? value.map(String).includes(String(deal[field]))
          : String(deal[field]) === String(value);
      }),
    );
    rows = rows.sort((a, b) => String(b.DATE_CREATE).localeCompare(String(a.DATE_CREATE)));
    const total = rows.length;
    const select = params.select as string[] | undefined;
    const page = rows
      .slice(0, 50)
      .map((row) =>
        select ? Object.fromEntries(Object.entries(row).filter(([k]) => select.includes(k))) : row,
      );
    return { result: page, total };
  }
}
