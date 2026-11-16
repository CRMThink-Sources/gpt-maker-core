import {
  type FunctionAnswers,
  type FunctionAnswerValue,
  type FunctionField,
  type FunctionReviewWarning,
  type FunctionTemplateContent,
  EXPECTATION_MIN,
  type ReviewFieldResult,
  type ReviewGap,
  type ReviewProblem,
  type KnowledgeItem,
  REVIEW_TEXT_KEY,
  reviewableFields,
  reviewFunctionAnswers,
  type ReviewSuggestion,
  selectedValues,
  validateFunctionAnswers,
} from '@gptmaker/contracts';
import { createT, type T } from '@/i18n';
import { DEFAULT_LOCALE } from '@/i18n/config';

/** Lógica pura da revisão (spec agent-knowledge-review), separada da tela para ser testada. */

/** Sem `t` (testes, chamadas fora da tela) vale o idioma padrão. */
const defaultT = () => createT(DEFAULT_LOCALE, 'assist');

/** Máximo de avisos mostrados por campo; o resto fica em "ver mais" (design D8). */
export const WARNINGS_PER_FIELD = 3;

/** `attention` antes de `hint`, mantendo a ordem de origem dentro de cada gravidade. */
export function sortedWarnings(warnings: FunctionReviewWarning[]): FunctionReviewWarning[] {
  const rank = (warning: FunctionReviewWarning) => (warning.severity === 'attention' ? 0 : 1);
  return warnings
    .map((warning, index) => ({ warning, index }))
    .sort((a, b) => rank(a.warning) - rank(b.warning) || a.index - b.index)
    .map((entry) => entry.warning);
}

/** Id do campo de primeiro nível que contém cada campo (dependentes apontam para o pai). */
export function topLevelIds(
  fields: readonly FunctionField[],
  answers: FunctionAnswers,
): Map<string, string> {
  const map = new Map<string, string>();
  const visit = (list: readonly FunctionField[], top?: string) => {
    for (const field of list) {
      const root = top ?? field.id;
      map.set(field.id, root);
      if (field.kind !== 'CHOICE' && field.kind !== 'MULTI_CHOICE') continue;
      const chosen = selectedValues(answers[field.id]);
      visit(
        field.options
          .filter((option) => chosen.includes(option.value))
          .flatMap((option) => option.dependents ?? []),
        root,
      );
    }
  };
  visit(fields);
  return map;
}

/** A resposta do campo como texto estável, para saber se mudou depois da revisão. */
export function answerKey(value: FunctionAnswerValue | undefined): string {
  return JSON.stringify(value ?? null);
}

/** Campos revisáveis preenchidos agora: o que o botão "Revisar com IA" vai ler. */
export function reviewableIds(form: FunctionTemplateContent, answers: FunctionAnswers): string[] {
  return reviewableFields(form, answers).map((field) => field.id);
}

/** Texto do botão: o custo em créditos com a chave da CRMThink, ou "sem uso de créditos". */
export function reviewCost(
  creditsPerField: number,
  fieldCount: number,
  ownKey: boolean,
  t: T = defaultT(),
): { credits: number; label: string } {
  if (ownKey) return { credits: 0, label: t('review.costNone') };
  const credits = creditsPerField * fieldCount;
  return { credits, label: t('review.cost', { count: credits }) };
}

/**
 * A resposta do campo com o texto sugerido no lugar. `index` é a posição do item (0 no texto
 * simples); `values` traz `text` nos textos e listas, ou os subcampos na base. `null` se a
 * resposta mudou e o item não existe mais.
 */
export function withSuggestion(
  field: FunctionField,
  current: FunctionAnswerValue | undefined,
  index: number,
  values: ReviewSuggestion['values'],
): FunctionAnswerValue | null {
  switch (field.kind) {
    case 'TEXT':
      return typeof current === 'string' && values[REVIEW_TEXT_KEY] !== undefined
        ? values[REVIEW_TEXT_KEY]
        : null;
    case 'TEXT_LIST': {
      if (!Array.isArray(current) || typeof current[index] !== 'string') return null;
      const text = values[REVIEW_TEXT_KEY];
      if (text === undefined) return null;
      return (current as string[]).map((item, i) => (i === index ? text : item));
    }
    case 'KNOWLEDGE': {
      if (!Array.isArray(current)) return null;
      const items = current as KnowledgeItem[];
      if (!items[index]) return null;
      return items.map((item, i) =>
        i === index ? { ...item, values: { ...item.values, ...values } } : item,
      );
    }
    default:
      return null;
  }
}

/**
 * "Aplicar" só aparece se a sugestão veio aplicável do servidor e passa na validação local do
 * campo com o texto no lugar (limites e obrigatórios).
 */
export function canApply(
  form: FunctionTemplateContent,
  answers: FunctionAnswers,
  field: FunctionField,
  index: number,
  suggestion: ReviewSuggestion,
): boolean {
  if (!suggestion.applicable) return false;
  const next = withSuggestion(field, answers[field.id], index, suggestion.values);
  if (next === null) return false;
  const { issues } = validateFunctionAnswers(
    form,
    { ...answers, [field.id]: next },
    { partial: true },
  );
  return !issues.some(
    (issue) => issue.field === field.id || issue.field.startsWith(`${field.id}[`),
  );
}

/** Avisos `attention`: só eles pedem confirmação ao publicar; `hint` publica direto. */
export function attentionCount(form: FunctionTemplateContent, answers: FunctionAnswers): number {
  // O marcador [preencher: …] não pede confirmação: a prévia já o recusa, apontando o campo.
  return reviewFunctionAnswers(form, answers).filter(
    (warning) => warning.severity === 'attention' && warning.code !== 'PENDING_PLACEHOLDER',
  ).length;
}

/** A expectativa vale para a cobertura a partir do mínimo de caracteres (já sem espaços nas pontas). */
export function expectationValid(expectation: string): boolean {
  return expectation.trim().length >= EXPECTATION_MIN;
}

/** A base com o item sugerido no fim; o `itemKey` é novo e todos os subcampos existem. */
export function withGapItem(
  field: FunctionField,
  current: FunctionAnswerValue | undefined,
  values: Record<string, string>,
  itemKey: string,
): FunctionAnswerValue | null {
  if (field.kind !== 'KNOWLEDGE') return null;
  const items = Array.isArray(current) ? (current as KnowledgeItem[]) : [];
  const item: KnowledgeItem = {
    itemKey,
    values: Object.fromEntries(field.subfields.map((sub) => [sub.id, values[sub.id] ?? ''])),
  };
  return [...items, item];
}

/** "Adicionar" só aparece se a lacuna veio aplicável e o item passa na validação local do campo. */
export function canAddGap(
  form: FunctionTemplateContent,
  answers: FunctionAnswers,
  field: FunctionField | undefined,
  gap: ReviewGap,
): boolean {
  if (!field || !gap.applicable) return false;
  const next = withGapItem(field, answers[field.id], gap.item, crypto.randomUUID());
  if (next === null) return false;
  if (field.kind === 'KNOWLEDGE' && (next as KnowledgeItem[]).length > field.maxItems) return false;
  const { issues } = validateFunctionAnswers(
    form,
    { ...answers, [field.id]: next },
    { partial: true },
  );
  return !issues.some(
    (issue) => issue.field === field.id || issue.field.startsWith(`${field.id}[`),
  );
}

/** Problemas por item acima disso: os de melhoria (`polish`) ficam recolhidos (spec, categoria e gravidade). */
export const PROBLEMS_COLLAPSE_ABOVE = 3;

/** `blocks` antes de `polish`, mantendo a ordem de origem dentro de cada gravidade. */
export function sortedProblems(problems: ReviewProblem[]): ReviewProblem[] {
  const rank = (problem: ReviewProblem) => (problem.severity === 'blocks' ? 0 : 1);
  return problems
    .map((problem, index) => ({ problem, index }))
    .sort((a, b) => rank(a.problem) - rank(b.problem) || a.index - b.index)
    .map((entry) => entry.problem);
}

/**
 * O que mostrar de um item: com mais de 3 problemas só os que atrapalham ficam à vista e os de
 * melhoria vão para `hidden`, atrás de "ver mais".
 */
export function visibleProblems(problems: ReviewProblem[]): {
  shown: ReviewProblem[];
  hidden: ReviewProblem[];
} {
  const sorted = sortedProblems(problems);
  if (sorted.length <= PROBLEMS_COLLAPSE_ABOVE) return { shown: sorted, hidden: [] };
  return {
    shown: sorted.filter((problem) => problem.severity === 'blocks'),
    hidden: sorted.filter((problem) => problem.severity === 'polish'),
  };
}

/** Itens com problema que atrapalha o agente x itens só com melhorias, nos campos já revisados. */
export function reviewImpact(results: Array<Pick<ReviewFieldResult, 'items'>>): {
  blocking: number;
  polishOnly: number;
} {
  let blocking = 0;
  let polishOnly = 0;
  for (const result of results) {
    for (const item of result.items) {
      if (item.problems.some((problem) => problem.severity === 'blocks')) blocking++;
      else if (item.problems.length > 0) polishOnly++;
    }
  }
  return { blocking, polishOnly };
}

/** Frase do resumo da revisão; `null` quando não há nada a dizer. */
export function impactMessage(
  impact: { blocking: number; polishOnly: number },
  t: T = defaultT(),
): string | null {
  const parts: string[] = [];
  if (impact.blocking > 0) parts.push(t('review.impactBlocking', { count: impact.blocking }));
  if (impact.polishOnly > 0) parts.push(t('review.impactPolish', { count: impact.polishOnly }));
  return parts.length ? parts.join(t('review.impactJoin')) : null;
}
