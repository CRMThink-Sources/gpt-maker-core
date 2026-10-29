import type {
  CrmAccessInput,
  CrmAccessStatus,
  CrmAccessView,
  CrmCatalogView,
  CrmEntity,
  CrmFieldSettingInput,
  CrmFieldView,
} from '@gptmaker/contracts';
import type { Tone } from '@/components/ui';
import { errorMessage } from './agents';
import { ApiRequestError, type PlatformSessionClient } from './platform-session';

/** `api` da sessão do iframe (`useAppSession().api`). */
type Api = PlatformSessionClient['api'];

/** Catálogo do CRM do portal, com as escolhas do cliente (cache do servidor). */
export function getCrmCatalog(api: Api): Promise<CrmCatalogView> {
  return api<CrmCatalogView>('/app/crm/fields');
}

/** Relê os campos e funis direto do Bitrix24. */
export function refreshCrmCatalog(api: Api): Promise<CrmCatalogView> {
  return api<CrmCatalogView>('/app/crm/refresh', { method: 'POST' });
}

/** Salva se o agente pode ler o campo e a descrição dele. */
export function saveCrmField(
  api: Api,
  entity: CrmEntity,
  code: string,
  body: CrmFieldSettingInput,
): Promise<CrmFieldView> {
  return api<CrmFieldView>(
    `/app/crm/fields/${encodeURIComponent(entity)}/${encodeURIComponent(code)}`,
    { method: 'PUT', body: JSON.stringify(body) },
  );
}

export function getCrmAccess(api: Api, agentId: string): Promise<CrmAccessView> {
  return api<CrmAccessView>(`/app/agents/${encodeURIComponent(agentId)}/crm-access`);
}

/** Liga ou desliga o acesso do agente ao CRM (pode levar de 10 a 30 segundos). */
export function setCrmAccess(
  api: Api,
  agentId: string,
  body: CrmAccessInput,
): Promise<CrmAccessView> {
  return api<CrmAccessView>(`/app/agents/${encodeURIComponent(agentId)}/crm-access`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/** 404 nas rotas do CRM: o recurso está desligado neste ambiente. */
export function crmFeatureOff(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

/** O Bitrix24 não respondeu a tempo (503 `CRM_UNAVAILABLE`). */
export function crmUnavailable(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === 'CRM_UNAVAILABLE';
}

const MESSAGES: Record<string, string> = {
  CRM_UNAVAILABLE: 'O Bitrix24 não respondeu agora. Aguarde um pouco e tente de novo.',
  CRM_ACCESS_BUSY:
    'Outra alteração do acesso ao CRM deste agente está em andamento. Aguarde alguns segundos e tente de novo.',
};

/** Mensagem para o usuário nas telas do CRM. */
export function crmErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && MESSAGES[error.code]) return MESSAGES[error.code]!;
  return errorMessage(error, fallback);
}

/** Ordem das abas na tela "CRM para o agente". */
export const CRM_ENTITY_TABS: CrmEntity[] = ['contact', 'deal', 'lead', 'company'];

const FIELD_TYPES: Record<string, string> = {
  string: 'Texto',
  integer: 'Número inteiro',
  double: 'Número',
  money: 'Valor',
  date: 'Data',
  datetime: 'Data e hora',
  enumeration: 'Lista',
  crm_status: 'Lista do CRM',
  boolean: 'Sim/não',
  char: 'Sim/não',
  user: 'Usuário',
  employee: 'Usuário',
  crm_multifield: 'Telefone, e-mail ou contato',
  crm_currency: 'Moeda',
  crm_category: 'Funil',
  crm_stage: 'Etapa do funil',
  url: 'Link',
  address: 'Endereço',
};

/** Tipo do campo do Bitrix24 na linguagem do usuário. */
export function fieldTypeLabel(type: string): string {
  return FIELD_TYPES[type] ?? type;
}

/** Quando o agente usa os campos de cada entidade (spec agent-crm-tools, "Identificar o cliente"). */
export const CRM_ENTITY_USAGE: Record<CrmEntity, string> = {
  contact: 'O agente usa estes campos ao identificar o cliente da conversa.',
  deal: 'O agente lê estes campos nos negócios do cliente (até 10, do mais recente para o mais antigo).',
  lead: 'Usados quando a conversa está ligada a um lead e ainda não há contato.',
  company: 'Usados quando a conversa está ligada só a uma empresa.',
};

/** Valor fictício por tipo, para a prévia do que o agente recebe. */
const EXAMPLE_VALUES: Record<string, string> = {
  string: 'Exemplo',
  integer: '42',
  double: '42',
  money: 'R$ 1.500,00',
  date: '15/03/2026',
  datetime: '15/03/2026 14:30',
  boolean: 'Sim',
  char: 'Sim',
  user: 'Ana (responsável)',
  employee: 'Ana (responsável)',
  crm_multifield: '(11) 91234-5678',
  crm_currency: 'Real',
  crm_category: 'Vendas',
  crm_stage: 'Proposta enviada',
  url: 'https://exemplo.com.br',
  address: 'Av. Paulista, 1000 - São Paulo',
};

/**
 * Valor fictício de campos padrão conhecidos, antes do valor por tipo: "Exemplo" em todo campo de
 * texto não mostrava nada. Chave `entidade:código` vence a só pelo código (TITLE muda por entidade).
 */
const EXAMPLE_BY_FIELD: Record<string, string> = {
  NAME: 'Maria',
  SECOND_NAME: 'Aparecida',
  LAST_NAME: 'Souza',
  POST: 'Gerente comercial',
  COMMENTS: 'Prefere contato por WhatsApp',
  ADDRESS: 'Av. Paulista, 1000 - São Paulo',
  'deal:TITLE': 'Implantação do CRM',
  'lead:TITLE': 'Contato pelo site',
  'company:TITLE': 'ACME Ltda',
  'lead:COMPANY_TITLE': 'ACME Ltda',
};

export interface AgentPreviewLine {
  label: string;
  example: string;
  description: string;
}

/**
 * Prévia do que o agente recebe: só os campos expostos, com um valor fictício coerente com o tipo
 * (o primeiro valor aceito, quando for lista). Não lê dados reais do portal.
 */
export function buildAgentPreview(fields: CrmFieldView[]): AgentPreviewLine[] {
  return fields
    .filter((field) => field.exposed && field.available)
    .map((field) => ({
      label: field.label,
      example:
        field.options[0] ??
        (field.custom
          ? undefined
          : (EXAMPLE_BY_FIELD[`${field.entity}:${field.code}`] ?? EXAMPLE_BY_FIELD[field.code])) ??
        EXAMPLE_VALUES[field.type] ??
        '…',
      description: field.description.trim(),
    }));
}

/** Valores aceitos resumidos: os primeiros e quantos faltam. */
export function summarizeOptions(options: string[], max = 6): string {
  if (options.length <= max) return options.join(', ');
  const shown = options.slice(0, max - 1);
  return `${shown.join(', ')} e mais ${options.length - shown.length}`;
}

export const CRM_ACCESS_STATUS: Record<CrmAccessStatus, { label: string; tone: Tone }> = {
  DISABLED: { label: 'Desligado', tone: 'zinc' },
  CONNECTING: { label: 'Conectando', tone: 'brand' },
  CONNECTED: { label: 'Conectado', tone: 'green' },
  ERROR: { label: 'Erro ao conectar', tone: 'amber' },
};
