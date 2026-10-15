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
  url: 'Link',
  address: 'Endereço',
};

/** Tipo do campo do Bitrix24 na linguagem do usuário. */
export function fieldTypeLabel(type: string): string {
  return FIELD_TYPES[type] ?? type;
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
