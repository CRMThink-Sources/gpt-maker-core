import {
  type ConversationMessage,
  flattenFields,
  type FunctionAnswers,
  type FunctionTemplateContent,
  HALLUCINATION_MAX_FLAGGED,
  type HallucinationCause,
  type HallucinationRequest,
  type HallucinationSuggestion,
  type HallucinationVerdict,
} from '@gptmaker/contracts';
import type { Tone } from '@/components/ui';
import type { T } from '@/i18n';
import { canAddGap, canApply, withGapItem, withSuggestion } from './review-logic';

/** Lógica pura da análise de alucinação (spec agent-hallucination-analysis), separada da tela. */

/** Só resposta do agente com texto pode ser marcada como suspeita. */
export function flaggable(message: Pick<ConversationMessage, 'role' | 'text'>): boolean {
  return message.role === 'AGENT' && message.text.trim() !== '';
}

/** Marca ou desmarca a resposta; passa do limite de marcações, a nova não entra. */
export function toggleFlag(flagged: readonly string[], id: string): string[] {
  if (flagged.includes(id)) return flagged.filter((entry) => entry !== id);
  if (flagged.length >= HALLUCINATION_MAX_FLAGGED) return [...flagged];
  return [...flagged, id];
}

/** Corpo do pedido; nota vazia (ou só espaços) não vai. */
export function buildRequest(input: {
  analysisId: string;
  source: HallucinationRequest['source'];
  conversationId: string;
  flagged: readonly string[];
  note: string;
  answers: FunctionAnswers;
}): HallucinationRequest {
  const note = input.note.trim();
  return {
    analysisId: input.analysisId,
    source: input.source,
    conversationId: input.conversationId,
    flaggedMessageIds: [...input.flagged],
    ...(note ? { note } : {}),
    answers: input.answers,
  };
}

/** Texto do custo: créditos com a chave da CRMThink, ou "sem uso de créditos" com a do cliente. */
export function analysisCost(
  creditsPerAnalysis: number,
  ownKey: boolean,
  t: T,
): { credits: number; label: string } {
  if (ownKey) return { credits: 0, label: t('cost.none') };
  return { credits: creditsPerAnalysis, label: t('cost.credits', { count: creditsPerAnalysis }) };
}

function fieldOf(form: FunctionTemplateContent, fieldId: string) {
  return flattenFields(form.fields).find((field) => field.id === fieldId);
}

/**
 * "Aplicar" só aparece se a sugestão veio aplicável do servidor e passa na validação local do campo
 * com o texto no lugar (limites, obrigatórios e quantos itens cabem).
 */
export function suggestionApplicable(
  form: FunctionTemplateContent,
  answers: FunctionAnswers,
  suggestion: HallucinationSuggestion,
): boolean {
  if (!suggestion.applicable) return false;
  const field = fieldOf(form, suggestion.fieldId);
  if (!field) return false;
  if (suggestion.kind === 'ADD_ITEM') {
    return canAddGap(form, answers, field, {
      fieldId: suggestion.fieldId,
      title: '',
      why: '',
      item: suggestion.item,
      applicable: true,
    });
  }
  return canApply(form, answers, field, suggestion.index, {
    values: suggestion.values,
    applicable: true,
  });
}

/**
 * As respostas com a sugestão aplicada (item novo no fim da base ou texto trocado), ou `null` se a
 * sugestão já não cabe (o formulário mudou desde a análise). Não salva nem publica.
 */
export function applySuggestion(
  form: FunctionTemplateContent,
  answers: FunctionAnswers,
  suggestion: HallucinationSuggestion,
  itemKey: string,
): FunctionAnswers | null {
  if (!suggestionApplicable(form, answers, suggestion)) return null;
  const field = fieldOf(form, suggestion.fieldId)!;
  const next =
    suggestion.kind === 'ADD_ITEM'
      ? withGapItem(field, answers[field.id], suggestion.item, itemKey)
      : withSuggestion(field, answers[field.id], suggestion.index, suggestion.values);
  return next === null ? null : { ...answers, [field.id]: next };
}

export const VERDICT_TONE: Record<HallucinationVerdict, Tone> = {
  SUPPORTED: 'green',
  UNSUPPORTED: 'amber',
  CONTRADICTS: 'red',
};

export const verdictKey = (verdict: HallucinationVerdict) => `verdict.${verdict}`;
export const causeKey = (cause: HallucinationCause) => `cause.${cause}`;

/** Por que a sugestão está só para leitura. */
export function readOnlyReasonKey(suggestion: HallucinationSuggestion): string {
  return `readOnly.${suggestion.reason ?? 'GENERIC'}`;
}

/** Rotas da análise (o id da conversa do GPTMaker tem `:`, por isso vai codificado). */
const agentBase = (agentId: string) => `/app/agents/${encodeURIComponent(agentId)}`;

export const conversationsPath = (
  agentId: string,
  source: HallucinationRequest['source'],
  cursor: number,
) => `${agentBase(agentId)}/conversations?source=${source}&cursor=${cursor}`;

export const conversationMessagesPath = (
  agentId: string,
  source: HallucinationRequest['source'],
  conversationId: string,
) =>
  `${agentBase(agentId)}/conversations/${encodeURIComponent(conversationId)}/messages?source=${source}`;

export const analysisPath = (agentId: string) => `${agentBase(agentId)}/function/hallucination`;
