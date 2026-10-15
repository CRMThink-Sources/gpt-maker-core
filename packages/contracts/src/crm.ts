import { z } from 'zod';

/**
 * Camada semântica do CRM (spec crm-semantic-layer): o que o agente pode ler do Bitrix24 de cada
 * cliente, com nomes de negócio no lugar dos códigos técnicos.
 */
export const CRM_ENTITIES = ['lead', 'deal', 'contact', 'company'] as const;
export const crmEntitySchema = z.enum(CRM_ENTITIES);
export type CrmEntity = z.infer<typeof crmEntitySchema>;

export const CRM_ENTITY_LABELS: Record<CrmEntity, string> = {
  lead: 'Leads',
  deal: 'Negócios',
  contact: 'Contatos',
  company: 'Empresas',
};

export interface CrmOption {
  id: string;
  label: string;
}

/** Campo do portal já traduzido: rótulo, tipo e valores aceitos. */
export interface SemanticField {
  entity: CrmEntity;
  code: string;
  label: string;
  /** Tipo do Bitrix (`string`, `enumeration`, `crm_status`, `user`, `crm_multifield`...). */
  type: string;
  custom: boolean;
  multiple: boolean;
  /** Lista, status ou booleano: valores aceitos, pelo id gravado no registro. */
  options?: CrmOption[];
}

export type StageSemantic = 'process' | 'success' | 'failure';

export const STAGE_SEMANTIC_LABELS: Record<StageSemantic, string> = {
  process: 'em andamento',
  success: 'ganha',
  failure: 'perdida',
};

export interface PipelineStage {
  id: string;
  name: string;
  sort: number;
  semantic: StageSemantic;
}

export interface Pipeline {
  id: number;
  name: string;
  isDefault: boolean;
  stages: PipelineStage[];
}

/** Metadado de `crm.<entidade>.fields` (só o que a camada semântica usa). */
export interface RawCrmField {
  type: string;
  title?: string;
  formLabel?: string;
  listLabel?: string;
  isMultiple?: boolean;
  statusType?: string;
  items?: Array<{ ID: string | number; VALUE: string }>;
}

/** Linha de `crm.status.list`. */
export interface RawCrmStatus {
  STATUS_ID: string;
  NAME: string;
  SORT?: string | number;
  SEMANTICS?: string | null;
  EXTRA?: { SEMANTICS?: string | null } | null;
}

/** Categoria de `crm.category.list` (`entityTypeId: 2`). */
export interface RawCrmCategory {
  id: number | string;
  name: string;
  sort?: number | string;
  isDefault?: string | boolean;
}

/**
 * Códigos que o app trata à parte (funil, etapa, vínculos) ou que só têm sentido técnico: nunca
 * entram no catálogo como campo.
 */
const TECHNICAL_FIELDS = new Set([
  'ID',
  'CATEGORY_ID',
  'STAGE_ID',
  'STAGE_SEMANTIC_ID',
  'STATUS_SEMANTIC_ID',
  'CONTACT_ID',
  'CONTACT_IDS',
  'COMPANY_ID',
  'LEAD_ID',
  'QUOTE_ID',
  'ORIGINATOR_ID',
  'ORIGIN_ID',
  'ORIGIN_VERSION',
  'IS_RECURRING',
  'IS_RETURN_CUSTOMER',
  'IS_REPEATED_APPROACH',
  'IS_NEW',
  'IS_MANUAL_OPPORTUNITY',
  'HAS_PHONE',
  'HAS_EMAIL',
  'HAS_IMOL',
  'FACE_ID',
  'LAST_ACTIVITY_BY',
  'LAST_ACTIVITY_TIME',
  'UTM_SOURCE',
  'UTM_MEDIUM',
  'UTM_CAMPAIGN',
  'UTM_CONTENT',
  'UTM_TERM',
  'LOCATION_ID',
  'PHOTO',
  'LOGO',
]);

/** Tipos sem valor legível em texto. */
const UNSUPPORTED_TYPES = new Set([
  'crm_category',
  'crm_company',
  'crm_contact',
  'crm_lead',
  'crm_deal',
  'crm_quote',
  'crm_entity',
  'file',
  'crm',
  'resourcebooking',
  'iblock_section',
  'iblock_element',
  'location',
  'recurring_params',
  'product_property',
]);

const BOOLEAN_OPTIONS: CrmOption[] = [
  { id: '1', label: 'Sim' },
  { id: '0', label: 'Não' },
];

/** Campo personalizado com valor sim/não (`boolean`) ou campo padrão `char` com `Y`/`N`. */
export function isBooleanField(field: Pick<SemanticField, 'type'>): boolean {
  return field.type === 'boolean' || field.type === 'char';
}

/** Tipos de status citados pelos campos `crm_status` (para ler as listas em `crm.status.list`). */
export function statusTypesOf(raw: Record<string, RawCrmField>): string[] {
  return [
    ...new Set(
      Object.values(raw)
        .filter((field) => field.type === 'crm_status' && field.statusType)
        .map((field) => field.statusType!),
    ),
  ];
}

/**
 * Campos de uma entidade a partir de `crm.<entidade>.fields`, com rótulo do usuário nos campos
 * personalizados (`formLabel`/`listLabel`) e título nos padrão; listas de status de
 * `statusLists[statusType]`. Ordem: padrão primeiro, depois por rótulo.
 */
export function normalizeCrmFields(
  entity: CrmEntity,
  raw: Record<string, RawCrmField>,
  statusLists: Record<string, CrmOption[]> = {},
): SemanticField[] {
  return Object.entries(raw)
    .filter(([code, field]) => !TECHNICAL_FIELDS.has(code) && !UNSUPPORTED_TYPES.has(field.type))
    .map(([code, field]): SemanticField => {
      const custom = code.startsWith('UF_');
      let options: CrmOption[] | undefined;
      if (field.type === 'enumeration' && field.items) {
        options = field.items.map((item) => ({ id: String(item.ID), label: item.VALUE }));
      } else if (field.type === 'boolean') {
        options = BOOLEAN_OPTIONS;
      } else if (field.type === 'crm_status' && field.statusType) {
        options = statusLists[field.statusType];
      }
      return {
        entity,
        code,
        label: (custom ? field.formLabel || field.listLabel : field.title) || field.title || code,
        type: field.type,
        custom,
        multiple: Boolean(field.isMultiple),
        ...(options ? { options } : {}),
      };
    })
    .sort((a, b) => Number(a.custom) - Number(b.custom) || a.label.localeCompare(b.label, 'pt-BR'));
}

/** Itens de uma lista de `crm.status.list`, na ordem do portal. */
export function normalizeStatusList(rows: RawCrmStatus[]): CrmOption[] {
  return [...rows]
    .sort((a, b) => Number(a.SORT ?? 0) - Number(b.SORT ?? 0))
    .map((row) => ({ id: row.STATUS_ID, label: row.NAME }));
}

/** Semântica da etapa: `S`/`success` ganha, `F`/`failure` perdida, o resto em andamento. */
export function stageSemantic(row: RawCrmStatus): StageSemantic {
  const value = (row.SEMANTICS ?? row.EXTRA?.SEMANTICS ?? '').toString().toLowerCase();
  if (value === 's' || value === 'success') return 'success';
  if (value === 'f' || value === 'failure') return 'failure';
  return 'process';
}

/** Lista de status das etapas de um funil: `DEAL_STAGE` no geral (0), `DEAL_STAGE_<id>` nos demais. */
export function dealStageEntityId(pipelineId: number): string {
  return pipelineId === 0 ? 'DEAL_STAGE' : `DEAL_STAGE_${pipelineId}`;
}

/** Funis com as etapas na ordem do portal, o padrão primeiro. */
export function normalizePipelines(
  categories: RawCrmCategory[],
  stagesByPipeline: Record<number, RawCrmStatus[]>,
): Pipeline[] {
  return categories
    .map((category) => ({
      id: Number(category.id),
      name: category.name,
      sort: Number(category.sort ?? 0),
      isDefault: category.isDefault === 'Y' || category.isDefault === true,
    }))
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.sort - b.sort ||
        a.name.localeCompare(b.name, 'pt-BR'),
    )
    .map(({ id, name, isDefault }) => ({
      id,
      name,
      isDefault,
      stages: [...(stagesByPipeline[id] ?? [])]
        .sort((a, b) => Number(a.SORT ?? 0) - Number(b.SORT ?? 0))
        .map((row) => ({
          id: row.STATUS_ID,
          name: row.NAME,
          sort: Number(row.SORT ?? 0),
          semantic: stageSemantic(row),
        })),
    }));
}

/**
 * Campos padrão expostos ao agente enquanto o cliente não escolher (spec: nome, empresa,
 * responsável, funil, etapa, valor, moeda e datas). Funil, etapa e empresa vêm à parte nas
 * ferramentas. Campos personalizados, telefone e e-mail nunca entram por padrão.
 */
export const DEFAULT_EXPOSED_FIELDS: Record<CrmEntity, readonly string[]> = {
  lead: [
    'TITLE',
    'NAME',
    'LAST_NAME',
    'COMPANY_TITLE',
    'STATUS_ID',
    'ASSIGNED_BY_ID',
    'OPPORTUNITY',
    'CURRENCY_ID',
    'DATE_CREATE',
  ],
  deal: [
    'TITLE',
    'ASSIGNED_BY_ID',
    'OPPORTUNITY',
    'CURRENCY_ID',
    'BEGINDATE',
    'CLOSEDATE',
    'DATE_CREATE',
  ],
  contact: ['NAME', 'SECOND_NAME', 'LAST_NAME', 'POST', 'ASSIGNED_BY_ID', 'DATE_CREATE'],
  company: ['TITLE', 'ASSIGNED_BY_ID', 'DATE_CREATE'],
};

/** Exposição sem escolha do cliente. */
export function exposedByDefault(entity: CrmEntity, code: string): boolean {
  return DEFAULT_EXPOSED_FIELDS[entity].includes(code);
}

export const CRM_FIELD_DESCRIPTION_MAX = 300;

/** Escolha do cliente sobre um campo (painel "CRM para o agente"). */
export const crmFieldSettingInputSchema = z.object({
  exposed: z.boolean(),
  description: z
    .string()
    .trim()
    .max(CRM_FIELD_DESCRIPTION_MAX, `Use até ${CRM_FIELD_DESCRIPTION_MAX} caracteres`)
    .default(''),
});
export type CrmFieldSettingInput = z.input<typeof crmFieldSettingInputSchema>;

/** Campo na tela do catálogo. */
export interface CrmFieldView {
  entity: CrmEntity;
  code: string;
  label: string;
  type: string;
  custom: boolean;
  /** Valores aceitos (rótulos), quando o campo é lista, status ou sim/não. */
  options: string[];
  exposed: boolean;
  description: string;
  /** `false`: o cliente configurou, mas o campo não existe mais no portal. */
  available: boolean;
}

export interface CrmCatalogView {
  fields: CrmFieldView[];
  pipelines: Array<{
    id: number;
    name: string;
    stages: Array<{ name: string; semantic: StageSemantic }>;
  }>;
  /** Quando os metadados foram lidos do portal (ISO). */
  loadedAt: string;
}

export const CRM_ACCESS_STATUSES = ['DISABLED', 'CONNECTING', 'CONNECTED', 'ERROR'] as const;
export type CrmAccessStatus = (typeof CRM_ACCESS_STATUSES)[number];

export const crmAccessInputSchema = z.object({ enabled: z.boolean() });
export type CrmAccessInput = z.input<typeof crmAccessInputSchema>;

/** Acesso do agente ao CRM (bloco "Acesso ao CRM" do agente). */
export interface CrmAccessView {
  /** Recurso ligado no ambiente (flag `CRM_TOOLS_ENABLED`). */
  available: boolean;
  status: CrmAccessStatus;
  /** Motivo resumido da última falha ao conectar. */
  lastError: string | null;
  lastCallAt: string | null;
}
