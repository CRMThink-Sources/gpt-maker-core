import type {
  AgentEventName,
  TemplateContext,
  TriggerActionInput,
  TriggerActionType,
  TriggerExecutionView,
  IntentionActionInput,
  IntentionActionType,
} from '@gptmaker/contracts';
import type { T } from '@/i18n';
import type { Tone } from '@/components/ui';
import { ApiRequestError } from './platform-session';

/** Eventos do agente, na linguagem do usuário (textos em `triggers.events`). */
export function agentEvent(t: T, event: AgentEventName): { label: string; description: string } {
  return { label: t(`events.${event}.label`), description: t(`events.${event}.description`) };
}

/** Ação de gatilho ou de intenção (a intenção tem também a transferência para atendente). */
export type AnyActionType = TriggerActionType | IntentionActionType;
export type AnyActionInput = TriggerActionInput | IntentionActionInput;

/** Nome e descrição da ação (textos em `triggers.actions`). */
export function actionType(t: T, type: AnyActionType): { label: string; description: string } {
  return { label: t(`actions.${type}.label`), description: t(`actions.${type}.description`) };
}

/** Configuração inicial de cada tipo; `t` é o tradutor de `triggers` (textos iniciais no idioma da tela). */
export function newAction(t: T, type: AnyActionType): AnyActionInput {
  switch (type) {
    case 'CREATE_LEAD':
      return {
        type,
        config: {
          fields: {
            TITLE: t('defaults.leadTitle'),
            NAME: '{{contact.name}}',
            PHONE: '{{contact.phone}}',
          },
        },
      };
    case 'UPSERT_DEAL':
      return {
        type,
        config: {
          categoryId: 0,
          // Escolhida na tela: o código da etapa muda de funil para funil.
          stageId: '',
          fields: { TITLE: t('defaults.dealTitle') },
        },
      };
    case 'TIMELINE_COMMENT':
      return { type, config: { text: t('defaults.timelineText') } };
    case 'CREATE_TASK':
      return {
        type,
        config: { title: t('defaults.taskTitle'), responsibleId: 0 },
      };
    case 'START_BIZPROC':
      return { type, config: { templateId: 0, documentType: 'DEAL' } };
    case 'OUTBOUND_WEBHOOK':
      return { type, config: { url: '' } };
    case 'CREATE_SPA_ITEM':
      return {
        type,
        config: { entityTypeId: 0, title: t('defaults.spaTitle'), fields: {} },
      };
    case 'TRANSFER_TO_HUMAN':
      return { type, config: { target: 'OPERATOR' } };
  }
}

export function executionStatus(
  t: T,
  status: TriggerExecutionView['status'],
): {
  label: string;
  tone: Tone;
} {
  if (status === 'SUCCESS') return { label: t('status.SUCCESS'), tone: 'green' };
  if (status === 'FAILED') return { label: t('status.FAILED'), tone: 'amber' };
  return { label: t('status.PENDING'), tone: 'brand' };
}

/** Resumo do resultado da ação para o histórico. */
export function resultSummary(t: T, execution: TriggerExecutionView): string | null {
  const result = (execution.result ?? {}) as Record<string, unknown>;
  if (result.leadId) return t('result.lead', { id: String(result.leadId) });
  if (result.dealId) {
    return t(result.created ? 'result.dealNew' : 'result.deal', { id: String(result.dealId) });
  }
  if (result.commentId) {
    return t('result.comment', {
      entityType: String(result.entityType),
      entityId: String(result.entityId),
    });
  }
  if (result.taskId) return t('result.task', { id: String(result.taskId) });
  if (result.itemId) return t('result.spaItem', { id: String(result.itemId) });
  if (result.workflowId) return t('result.workflow', { id: String(result.workflowId) });
  if (result.status) return t('result.http', { status: String(result.status) });
  return null;
}

/** Contexto de exemplo para a prévia dos templates na tela (`t` do namespace `triggers`). */
export function sampleContext(t: T): TemplateContext {
  return {
    contact: { name: t('sample.contactName'), phone: '+55 11 99999-0000' },
    message: { text: t('sample.messageText'), role: 'user' },
    agent: { id: 'agente', name: t('sample.agentName') },
    event: { name: 'onFinishInteraction', date: new Date(0).toISOString() },
    dialog: { id: 'chat123' },
    interaction: { id: 'atendimento', protocol: '1005' },
    payload: { channel: 'API' },
  };
}

/** Descrição de uma variável de template (`triggers.variables`); sem tradução, a do contrato. */
export function variableLabel(t: T, path: string, fallback: string): string {
  const key = `variables.${path.replaceAll('.', '_')}`;
  return t.has(key) ? t(key) : fallback;
}

/** Erros de `templateErrors` (contrato, em pt-BR) no idioma da tela (`triggers.templateErrors`). */
export function templateErrorMessage(t: T, error: string): string {
  if (error === 'chaves {{ }} sem par') return t('templateErrors.unpaired');
  const invalid = /^variável inválida: (.*)$/.exec(error);
  if (invalid) return t('templateErrors.invalid', { token: invalid[1]! });
  const unknown = /^variável desconhecida: (.*)$/.exec(error);
  if (unknown) return t('templateErrors.unknown', { token: unknown[1]! });
  return error;
}

/**
 * Mensagem de uma falha de API: a traduzida por `error.code` (`message` vem de `useErrorMessage`);
 * falha de rede ou resposta sem envelope mostra o texto genérico da operação.
 */
export function apiFailure(
  error: unknown,
  message: (error: unknown) => string,
  fallback: string,
): string {
  if (!(error instanceof ApiRequestError) || error.code.startsWith('HTTP_')) return fallback;
  return message(error);
}
