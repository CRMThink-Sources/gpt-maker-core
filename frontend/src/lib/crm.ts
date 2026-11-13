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
import { createT, type T } from '@/i18n';
import { errorMessage } from './agents';
import { ApiRequestError, type PlatformSessionClient } from './platform-session';

/** Sem `t` (testes e quem ainda não traduz) vale o pt-BR do namespace `crm`. */
const fallbackT = createT('pt-BR', 'crm');

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

/**
 * Evento do navegador que o bloco "Acesso ao CRM" dispara depois de ligar ou desligar o acesso
 * com sucesso. Quem depende do acesso (a agenda do agente) relê o estado quando ele chega.
 */
export const CRM_ACCESS_CHANGED_EVENT = 'gptmaker:crm-access-changed';

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

const MESSAGE_CODES = ['CRM_UNAVAILABLE', 'CRM_ACCESS_BUSY'];

/**
 * Mensagem para o usuário nas telas do CRM. `translate` vem de `useErrorMessage('crm')`; sem ele,
 * os códigos conhecidos saem em pt-BR.
 */
export function crmErrorMessage(
  error: unknown,
  fallback: string,
  translate?: (error: unknown) => string,
): string {
  if (error instanceof ApiRequestError && MESSAGE_CODES.includes(error.code)) {
    return translate ? translate(error) : fallbackT(`errors.${error.code}`);
  }
  return errorMessage(error, fallback, translate);
}

/** Ordem das abas na tela "CRM para o agente". */
export const CRM_ENTITY_TABS: CrmEntity[] = ['contact', 'deal', 'lead', 'company'];

/** Tipo do campo do Bitrix24 na linguagem do usuário (`t` do namespace `crm`). */
export function fieldTypeLabel(type: string, t: T = fallbackT): string {
  return t.has(`fieldTypes.${type}`) ? t(`fieldTypes.${type}`) : type;
}

/** Quando o agente usa os campos de cada entidade (spec agent-crm-tools, "Identificar o cliente"). */
export function crmEntityUsage(entity: CrmEntity, t: T = fallbackT): string {
  return t(`usage.${entity}`);
}

/**
 * Valor fictício de campos padrão conhecidos (`preview.byField.*`), antes do valor por tipo
 * (`preview.byType.*`): "Exemplo" em todo campo de texto não mostrava nada. A chave
 * `entidade_CÓDIGO` vence a só pelo código (TITLE muda por entidade).
 */
function exampleFor(field: CrmFieldView, t: T): string | undefined {
  for (const key of [`byField.${field.entity}_${field.code}`, `byField.${field.code}`]) {
    if (t.has(`preview.${key}`)) return t(`preview.${key}`);
  }
  return undefined;
}

export interface AgentPreviewLine {
  label: string;
  example: string;
  description: string;
}

/**
 * Prévia do que o agente recebe: só os campos expostos, com um valor fictício coerente com o tipo
 * (o primeiro valor aceito, quando for lista). Não lê dados reais do portal.
 */
export function buildAgentPreview(fields: CrmFieldView[], t: T = fallbackT): AgentPreviewLine[] {
  return fields
    .filter((field) => field.exposed && field.available)
    .map((field) => ({
      label: field.label,
      example:
        field.options[0] ??
        (field.custom ? undefined : exampleFor(field, t)) ??
        (t.has(`preview.byType.${field.type}`) ? t(`preview.byType.${field.type}`) : '…'),
      description: field.description.trim(),
    }));
}

/** Valores aceitos resumidos: os primeiros e quantos faltam. */
export function summarizeOptions(options: string[], max = 6, t: T = fallbackT): string {
  if (options.length <= max) return options.join(', ');
  const shown = options.slice(0, max - 1);
  return t('options.more', { list: shown.join(', '), count: options.length - shown.length });
}

/** Selo do acesso do agente ao CRM; `label` em pt-BR, outro idioma via `crmAccessStatusLabel`. */
export const CRM_ACCESS_STATUS: Record<CrmAccessStatus, { label: string; tone: Tone }> = {
  DISABLED: { label: fallbackT('accessStatus.DISABLED'), tone: 'zinc' },
  CONNECTING: { label: fallbackT('accessStatus.CONNECTING'), tone: 'brand' },
  CONNECTED: { label: fallbackT('accessStatus.CONNECTED'), tone: 'green' },
  ERROR: { label: fallbackT('accessStatus.ERROR'), tone: 'amber' },
};

/** Rótulo do status do acesso ao CRM no idioma de `t` (namespace `crm`). */
export function crmAccessStatusLabel(status: CrmAccessStatus, t: T): string {
  return t(`accessStatus.${status}`);
}
