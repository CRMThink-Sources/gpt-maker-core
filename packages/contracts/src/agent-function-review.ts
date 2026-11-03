import { z } from 'zod';
import {
  type FunctionAnswers,
  type KnowledgeItem,
  bitrixSpaValueSchema,
  knowledgeItemSchema,
  visibleFields,
} from './agent-function-answers';
import { findPlaceholders } from './agent-function-placeholders';
import type { FunctionField, FunctionTemplateContent } from './agent-functions';

/**
 * Avisos sobre o preenchimento da função (spec agent-knowledge-review, "Avisos por regras fixas").
 * Sem IA e sem rede: roda no app a cada alteração e no backend. Nunca bloqueia salvar nem publicar;
 * obrigatórios e limites continuam em `validateFunctionAnswers`.
 */
export type FunctionReviewCode =
  | 'FEW_ITEMS'
  | 'SHORT_TEXT'
  | 'PLACEHOLDER_COPIED'
  | 'DUPLICATE_ITEMS'
  | 'NEAR_LIMIT'
  | 'SPA_DUPLICATE_FIELD'
  | 'SPA_PARTIAL_OPTIONS'
  | 'PENDING_PLACEHOLDER';

export type FunctionReviewSeverity = 'attention' | 'hint';

export interface FunctionReviewWarning {
  /** Id do campo do formulário. */
  field: string;
  /** Posição do item (a partir de 0), nas listas e na base. */
  item?: number;
  /** Subcampo da base ou valor do processo inteligente. */
  subfield?: string;
  code: FunctionReviewCode;
  severity: FunctionReviewSeverity;
  message: string;
}

/** Acima desta fração do limite de caracteres, o texto está "perto do limite". */
export const REVIEW_NEAR_LIMIT_RATIO = 0.9;

const SEVERITY: Record<FunctionReviewCode, FunctionReviewSeverity> = {
  FEW_ITEMS: 'attention',
  SHORT_TEXT: 'hint',
  PLACEHOLDER_COPIED: 'attention',
  DUPLICATE_ITEMS: 'attention',
  NEAR_LIMIT: 'hint',
  SPA_DUPLICATE_FIELD: 'attention',
  SPA_PARTIAL_OPTIONS: 'attention',
  PENDING_PLACEHOLDER: 'attention',
};

const knowledgeItemsSchema = z.array(knowledgeItemSchema);

/** Minúsculas, sem acento, pontuação nem espaços repetidos: "Não  entra!" e "nao entra" são iguais. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Só caixa e espaços: o texto de exemplo copiado pode ter perdido a pontuação, mas não a forma. */
function sameText(a: string, b: string): boolean {
  const squash = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
  return squash(a) === squash(b);
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Grupos de posições que têm a mesma chave normalizada (chave vazia não conta). */
function duplicateGroups(keys: ReadonlyArray<string | undefined>): number[][] {
  const groups = new Map<string, number[]>();
  keys.forEach((key, index) => {
    if (key) groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

export function reviewFunctionAnswers(
  content: Pick<FunctionTemplateContent, 'fields'>,
  answers: FunctionAnswers,
): FunctionReviewWarning[] {
  const warnings: FunctionReviewWarning[] = [];
  const warn = (
    code: FunctionReviewCode,
    where: Pick<FunctionReviewWarning, 'field' | 'item' | 'subfield'>,
    message: string,
  ) => {
    warnings.push({ ...where, code, severity: SEVERITY[code], message });
  };

  const nearLimit = (
    text: string,
    limit: number,
    where: Pick<FunctionReviewWarning, 'field' | 'item' | 'subfield'>,
  ) => {
    if (text.length > limit * REVIEW_NEAR_LIMIT_RATIO && text.length <= limit) {
      warn('NEAR_LIMIT', where, `Está perto do limite de ${limit} caracteres (${text.length}).`);
    }
  };

  const duplicates = (
    field: string,
    keys: ReadonlyArray<string | undefined>,
    positions: ReadonlyArray<number>,
  ) => {
    for (const group of duplicateGroups(keys)) {
      for (const index of group) {
        const others = group
          .filter((other) => other !== index)
          .map((other) => positions[other]! + 1);
        warn(
          'DUPLICATE_ITEMS',
          { field, item: positions[index]! },
          `Parece repetido com o ${plural(others.length, 'item', 'itens')} ${others.join(', ')}.`,
        );
      }
    }
  };

  const fewItems = (field: string, count: number, recommended: number | undefined) => {
    if (recommended === undefined || count >= recommended) return;
    warn(
      'FEW_ITEMS',
      { field },
      count === 0
        ? `Nenhum item preenchido; o recomendado é ter ao menos ${recommended}.`
        : `Só ${count} ${plural(count, 'item', 'itens')}; o recomendado é ter ao menos ${recommended}.`,
    );
  };

  for (const field of visibleFields(content.fields, answers)) {
    const value = answers[field.id];
    switch (field.kind) {
      case 'TEXT': {
        const text = typeof value === 'string' ? value.trim() : '';
        if (!text) break;
        if (field.placeholder && sameText(text, field.placeholder)) {
          warn(
            'PLACEHOLDER_COPIED',
            { field: field.id },
            'Este texto é igual ao exemplo do campo. Troque pelo texto da sua empresa.',
          );
        }
        const min = field.review?.minLength;
        if (min !== undefined && text.length < min) {
          warn(
            'SHORT_TEXT',
            { field: field.id },
            `Texto curto: ${text.length} caracteres; o recomendado é ao menos ${min}.`,
          );
        }
        nearLimit(text, field.maxLength, { field: field.id });
        break;
      }
      case 'URL': {
        if (typeof value === 'string')
          nearLimit(value.trim(), field.maxLength, { field: field.id });
        break;
      }
      case 'TEXT_LIST': {
        const items = Array.isArray(value)
          ? value
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
        fewItems(field.id, items.length, field.review?.recommendedItems);
        items.forEach((item, index) => {
          if (field.placeholder && sameText(item, field.placeholder)) {
            warn(
              'PLACEHOLDER_COPIED',
              { field: field.id, item: index },
              'Este item é igual ao exemplo do campo. Troque pelo seu texto.',
            );
          }
          nearLimit(item, field.itemMaxLength, { field: field.id, item: index });
        });
        duplicates(
          field.id,
          items.map(normalize),
          items.map((_item, index) => index),
        );
        break;
      }
      case 'KNOWLEDGE': {
        const parsed = knowledgeItemsSchema.safeParse(value);
        const items: KnowledgeItem[] = parsed.success ? parsed.data : [];
        const text = (item: KnowledgeItem, id: string) => (item.values[id] ?? '').trim();
        const filled = items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => field.subfields.some((subfield) => text(item, subfield.id)));
        fewItems(field.id, filled.length, field.review?.recommendedItems);
        // O primeiro subcampo é o título do item (problema, pergunta, nome): título igual é item repetido.
        const titleId = field.subfields[0]!.id;
        duplicates(
          field.id,
          filled.map(({ item }) => normalize(text(item, titleId)) || undefined),
          filled.map(({ index }) => index),
        );
        for (const { item, index } of filled) {
          for (const subfield of field.subfields) {
            const subtext = text(item, subfield.id);
            if (!subtext) continue;
            const where = { field: field.id, item: index, subfield: subfield.id };
            const min = subfield.review?.minLength;
            if (min !== undefined && subtext.length < min) {
              warn(
                'SHORT_TEXT',
                where,
                `Texto curto em "${subfield.label}": ${subtext.length} caracteres; o recomendado é ao menos ${min}.`,
              );
            }
            nearLimit(subtext, subfield.maxLength, where);
          }
        }
        break;
      }
      case 'BITRIX_SPA': {
        reviewSpa(field, value, warn);
        break;
      }
      default:
        break;
    }
  }
  // Trecho que a IA deixou para o cliente completar: bloqueia a publicação até ser preenchido.
  for (const where of findPlaceholders(content, answers)) {
    warn(
      'PENDING_PLACEHOLDER',
      where,
      'Este texto ainda tem um trecho [preencher: …] para você completar antes de publicar.',
    );
  }
  return warnings;
}

type WarnFn = (
  code: FunctionReviewCode,
  where: Pick<FunctionReviewWarning, 'field' | 'item' | 'subfield'>,
  message: string,
) => void;

/** Mapeamento do processo inteligente: só os valores que o template declara. */
function reviewSpa(
  field: Extract<FunctionField, { kind: 'BITRIX_SPA' }>,
  value: unknown,
  warn: WarnFn,
): void {
  const parsed = bitrixSpaValueSchema.safeParse(value);
  if (!parsed.success) return;
  const spa = parsed.data;

  const byCode = new Map<string, string[]>();
  for (const declared of field.values) {
    const code = spa.fields[declared.id];
    if (code) byCode.set(code, [...(byCode.get(code) ?? []), declared.id]);
  }
  for (const [code, ids] of byCode) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const others = field.values
        .filter((declared) => ids.includes(declared.id) && declared.id !== id)
        .map((declared) => `"${declared.label}"`)
        .join(', ');
      warn(
        'SPA_DUPLICATE_FIELD',
        { field: field.id, subfield: id },
        `O campo ${code} do processo também recebe ${others}. Cada valor precisa do seu campo.`,
      );
    }
  }

  for (const declared of field.values) {
    if (!declared.options?.length) continue;
    const chosen = spa.lists?.[declared.id] ?? {};
    const linked = declared.options.filter((option) => chosen[option] !== undefined);
    if (linked.length > 0 && linked.length < declared.options.length) {
      warn(
        'SPA_PARTIAL_OPTIONS',
        { field: field.id, subfield: declared.id },
        `Só ${linked.length} de ${declared.options.length} opções de "${declared.label}" estão ligadas a itens da lista. As outras ficam sem valor.`,
      );
    }
  }
}
