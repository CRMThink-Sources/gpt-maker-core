import {
  type FunctionAnswers,
  type FunctionAnswerValue,
  type FunctionField,
  type FunctionReviewWarning,
  type FunctionTemplateContent,
  EXPECTATION_MIN,
  type ReviewGap,
  type KnowledgeItem,
  REVIEW_TEXT_KEY,
  reviewableFields,
  reviewFunctionAnswers,
  type ReviewSuggestion,
  selectedValues,
  validateFunctionAnswers,
} from '@gptmaker/contracts';

/** Lógica pura da revisão (spec agent-knowledge-review), separada da tela para ser testada. */

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
): { credits: number; label: string } {
  if (ownKey) return { credits: 0, label: 'sem uso de créditos' };
  const credits = creditsPerField * fieldCount;
  return { credits, label: `${credits} ${credits === 1 ? 'crédito' : 'créditos'}` };
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

/** Texto do aviso "não pode adicionar" de uma lacuna. */
export const GAP_REASONS: Record<NonNullable<ReviewGap['reason']>, string> = {
  FULL: 'O campo já está no máximo de itens.',
  LIMIT: 'O rascunho passa do limite de caracteres do campo.',
  REQUIRED: 'O rascunho está incompleto: falta um subcampo obrigatório.',
};

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
