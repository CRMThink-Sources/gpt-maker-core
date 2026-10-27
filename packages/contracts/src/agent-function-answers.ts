import { z } from 'zod';
import type { FunctionField, FunctionTemplateContent } from './agent-functions';
import { TRAINING_TEXT_MAX } from './trainings';

/**
 * Respostas do formulário da função (spec agent-function-configuration). Chave = id do campo,
 * dependentes inclusive; a forma do valor depende do tipo do campo.
 */
export const knowledgeItemSchema = z.object({
  /** Liga o item ao treinamento entre edições (design D4). */
  itemKey: z.uuid(),
  values: z.record(z.string(), z.string().max(TRAINING_TEXT_MAX)),
});
export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>;

export const bitrixStageValueSchema = z.object({
  categoryId: z.number().int().nonnegative(),
  stageId: z.string().trim().min(1).max(50),
});

export const functionAnswerValueSchema = z.union([
  z.string().max(5000),
  z.array(z.string().max(5000)).max(50),
  /** Vários usuários do Bitrix24 (design D15). */
  z.array(z.number().int()).max(50),
  z.number().int(),
  bitrixStageValueSchema,
  z.array(knowledgeItemSchema).max(50),
]);
export type FunctionAnswerValue = z.infer<typeof functionAnswerValueSchema>;

export const functionAnswersSchema = z.record(z.string(), functionAnswerValueSchema);
export type FunctionAnswers = z.infer<typeof functionAnswersSchema>;

export interface AnswerIssue {
  field: string;
  message: string;
}

const httpUrl = z.url({ protocol: /^https?$/ });

/** Campos visíveis com as respostas dadas: dependentes só das opções escolhidas. */
export function visibleFields(
  fields: readonly FunctionField[],
  answers: FunctionAnswers,
): FunctionField[] {
  return fields.flatMap((field) => {
    if (field.kind !== 'CHOICE' && field.kind !== 'MULTI_CHOICE') return [field];
    const chosen = selectedValues(answers[field.id]);
    const dependents = field.options
      .filter((option) => chosen.includes(option.value))
      .flatMap((option) => option.dependents ?? []);
    return [field, ...visibleFields(dependents, answers)];
  });
}

/** Valores escolhidos de uma escolha única ou múltipla. */
export function selectedValues(value: FunctionAnswerValue | undefined): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

const SUBFIELD = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/**
 * Texto do treinamento de um item (formato do campo com os subcampos). Linha cujos subcampos
 * ficaram todos vazios sai inteira: "Valor: " sem valor não vira treinamento.
 */
export function renderKnowledgeItem(
  field: Extract<FunctionField, { kind: 'KNOWLEDGE' }>,
  item: KnowledgeItem,
): string {
  const value = (id: string) => (item.values[id] ?? '').trim();
  return field.format
    .split('\n')
    .filter((line) => {
      const ids = [...line.matchAll(SUBFIELD)].map((match) => match[1]!);
      return ids.length === 0 || ids.some((id) => value(id) !== '');
    })
    .map((line) => line.replace(SUBFIELD, (_match, id: string) => value(id)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isEmpty(value: FunctionAnswerValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Valida um campo; devolve o valor normalizado ou `undefined` (vazio ou inválido). */
function checkField(
  field: FunctionField,
  value: FunctionAnswerValue | undefined,
  issues: AnswerIssue[],
  partial: boolean,
): FunctionAnswerValue | undefined {
  const issue = (message: string) => {
    issues.push({ field: field.id, message });
  };
  const fail = (message: string): undefined => {
    issue(message);
    return undefined;
  };
  if (isEmpty(value)) {
    if (field.required && !partial) issue('campo obrigatório');
    return undefined;
  }

  switch (field.kind) {
    case 'TEXT': {
      if (typeof value !== 'string') return fail('informe um texto');
      const text = value.trim();
      if (text.length > field.maxLength) issue(`use até ${field.maxLength} caracteres`);
      return text;
    }
    case 'URL': {
      if (typeof value !== 'string' || !httpUrl.safeParse(value.trim()).success) {
        return fail('informe um endereço http ou https');
      }
      if (value.trim().length > field.maxLength) issue(`use até ${field.maxLength} caracteres`);
      return value.trim();
    }
    case 'TEXT_LIST': {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        return fail('informe uma lista de textos');
      }
      const items = (value as string[]).map((item) => item.trim()).filter(Boolean);
      if (items.length > field.maxItems) issue(`use no máximo ${field.maxItems} itens`);
      if (!partial && items.length < field.minItems)
        issue(`informe ao menos ${field.minItems} itens`);
      items.forEach((item, index) => {
        if (item.length > field.itemMaxLength) {
          issues.push({
            field: `${field.id}[${index}]`,
            message: `use até ${field.itemMaxLength} caracteres`,
          });
        }
      });
      return items;
    }
    case 'INTEGER': {
      if (typeof value !== 'number') return fail('informe um número inteiro');
      if (value < field.min || value > field.max)
        issue(`use um valor entre ${field.min} e ${field.max}`);
      return value;
    }
    case 'BITRIX_USER': {
      if (field.multiple) {
        const ids = Array.isArray(value) ? value : [value];
        if (ids.some((id) => typeof id !== 'number' || !Number.isInteger(id) || id <= 0)) {
          return fail('escolha usuários do Bitrix24');
        }
        const list = ids as number[];
        if (list.length > 20) issue('escolha no máximo 20 usuários');
        if (new Set(list).size !== list.length) issue('usuário repetido');
        return list;
      }
      if (typeof value !== 'number' || value <= 0) return fail('escolha um usuário');
      return value;
    }
    case 'BITRIX_OPENLINE': {
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        return fail('escolha um canal aberto');
      }
      return value;
    }
    case 'AGENT': {
      if (typeof value !== 'string' || !z.uuid().safeParse(value).success) {
        return fail('escolha um agente');
      }
      return value;
    }
    case 'BITRIX_STAGE': {
      const parsed = bitrixStageValueSchema.safeParse(value);
      if (!parsed.success) return fail('escolha o funil e a etapa');
      return parsed.data;
    }
    case 'CHOICE': {
      if (typeof value !== 'string' || !field.options.some((option) => option.value === value)) {
        return fail('escolha uma das opções');
      }
      return value;
    }
    case 'MULTI_CHOICE': {
      const values = selectedValues(value);
      if (
        !Array.isArray(value) ||
        values.some((item) => !field.options.some((o) => o.value === item))
      ) {
        return fail('escolha entre as opções');
      }
      // Na ordem das opções, sem repetir: o comportamento sai igual para a mesma escolha.
      return field.options.map((option) => option.value).filter((item) => values.includes(item));
    }
    case 'KNOWLEDGE': {
      const parsed = z.array(knowledgeItemSchema).safeParse(value);
      if (!parsed.success) return fail('itens inválidos');
      const items = parsed.data;
      if (items.length > field.maxItems) issue(`use no máximo ${field.maxItems} itens`);
      if (new Set(items.map((item) => item.itemKey)).size !== items.length)
        issue('itens repetidos');
      items.forEach((item, index) => {
        const path = `${field.id}[${index}]`;
        for (const subfield of field.subfields) {
          const text = (item.values[subfield.id] ?? '').trim();
          if (!text && subfield.required && !partial) {
            issues.push({ field: `${path}.${subfield.id}`, message: 'campo obrigatório' });
          }
          if (text.length > subfield.maxLength) {
            issues.push({
              field: `${path}.${subfield.id}`,
              message: `use até ${subfield.maxLength} caracteres`,
            });
          }
        }
        const length = renderKnowledgeItem(field, item).length;
        if (length > TRAINING_TEXT_MAX) {
          issues.push({
            field: path,
            message: `o item passa de ${TRAINING_TEXT_MAX} caracteres (${length})`,
          });
        }
      });
      return items.map((item) => ({
        itemKey: item.itemKey,
        values: Object.fromEntries(
          field.subfields.map((subfield) => [subfield.id, (item.values[subfield.id] ?? '').trim()]),
        ),
      }));
    }
  }
}

/**
 * Valida as respostas contra a versão do template. `partial` (rascunho) dispensa obrigatórios e
 * mínimos, mas mantém os limites. Respostas de campos ocultos ou desconhecidos são descartadas.
 */
export function validateFunctionAnswers(
  content: Pick<FunctionTemplateContent, 'fields'>,
  input: FunctionAnswers,
  options: { partial?: boolean } = {},
): { answers: FunctionAnswers; issues: AnswerIssue[] } {
  const issues: AnswerIssue[] = [];
  const answers: FunctionAnswers = {};
  // Visíveis pelas respostas normalizadas: uma escolha inválida não revela dependentes.
  const visit = (fields: readonly FunctionField[]) => {
    for (const field of fields) {
      const value = checkField(field, input[field.id], issues, options.partial === true);
      if (value !== undefined) answers[field.id] = value;
      if (field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE') {
        const chosen = selectedValues(answers[field.id]);
        visit(
          field.options
            .filter((option) => chosen.includes(option.value))
            .flatMap((option) => option.dependents ?? []),
        );
      }
    }
  };
  visit(content.fields);
  return { answers, issues };
}
