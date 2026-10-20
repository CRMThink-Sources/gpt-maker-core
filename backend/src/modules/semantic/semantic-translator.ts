import {
  type CrmEntity,
  exposedByDefault,
  isBooleanField,
  type Pipeline,
  type SemanticField,
  STAGE_SEMANTIC_LABELS,
} from '@gptmaker/contracts';
import type { CrmMetadata } from './field-catalog.service';

/** Valor entregue ao agente: rótulo, valor traduzido e o significado escrito pelo cliente. */
export interface SemanticValue {
  campo: string;
  valor: string;
  significado?: string;
}

export interface FieldChoice {
  exposed: boolean;
  description: string;
}

/** Escolhas do cliente por campo; sem escolha, vale o padrão (design S1). */
export class FieldChoices {
  constructor(private readonly choices: Map<string, FieldChoice> = new Map()) {}

  static key(entity: CrmEntity, code: string): string {
    return `${entity}:${code}`;
  }

  get(entity: CrmEntity, code: string): FieldChoice | undefined {
    return this.choices.get(FieldChoices.key(entity, code));
  }

  exposed(entity: CrmEntity, code: string): boolean {
    return this.get(entity, code)?.exposed ?? exposedByDefault(entity, code);
  }

  description(entity: CrmEntity, code: string): string {
    return this.get(entity, code)?.description ?? '';
  }

  /** Campos com escolha gravada (inclusive os que sumiram do portal). */
  entries(): Array<{ entity: CrmEntity; code: string } & FieldChoice> {
    return [...this.choices.entries()].map(([key, choice]) => {
      const [entity, ...rest] = key.split(':');
      return { entity: entity as CrmEntity, code: rest.join(':'), ...choice };
    });
  }
}

export interface TranslationContext {
  metadata: CrmMetadata;
  choices: FieldChoices;
  /** Nomes dos usuários do portal citados nos registros (id ⇒ nome). */
  users: ReadonlyMap<string, string>;
}

/** Corte dos textos livres: o agente recebe dado, não documento (design S1). */
export const MAX_VALUE_LENGTH = 500;

/** Campos expostos de uma entidade, na ordem do catálogo. */
export function exposedFields(entity: CrmEntity, ctx: Omit<TranslationContext, 'users'>) {
  return ctx.metadata.fields[entity].filter((field) => ctx.choices.exposed(entity, field.code));
}

/** Ids de usuário citados nos campos expostos (para buscar os nomes antes de traduzir). */
export function userIdsIn(
  entity: CrmEntity,
  records: Array<Record<string, unknown>>,
  ctx: Omit<TranslationContext, 'users'>,
): string[] {
  const ids = new Set<string>();
  for (const field of exposedFields(entity, ctx).filter((f) => f.type === 'user')) {
    for (const record of records) {
      for (const value of asList(record[field.code])) {
        const id = scalar(value);
        if (id && id !== '0') ids.add(id);
      }
    }
  }
  return [...ids];
}

/**
 * Registro do Bitrix ⇒ valores semânticos: só campos expostos, cada valor traduzido; valor vazio
 * ou sem tradução (item de lista inexistente, usuário desconhecido) é omitido.
 */
export function translateRecord(
  entity: CrmEntity,
  record: Record<string, unknown>,
  ctx: TranslationContext,
  /** Campos que a ferramenta já entrega à parte (título, valor...). */
  omit: ReadonlySet<string> = new Set(),
): SemanticValue[] {
  const values: SemanticValue[] = [];
  for (const field of exposedFields(entity, ctx)) {
    if (omit.has(field.code)) continue;
    const valor = translateValue(field, record, ctx);
    if (valor === null) continue;
    const significado = ctx.choices.description(entity, field.code).trim();
    values.push({ campo: field.label, valor, ...(significado ? { significado } : {}) });
  }
  return values;
}

function translateValue(
  field: SemanticField,
  record: Record<string, unknown>,
  ctx: TranslationContext,
): string | null {
  const parts = asList(record[field.code])
    .map((value) => translateOne(field, value, record, ctx))
    .filter((value): value is string => value !== null && value !== '');
  if (!parts.length) return null;
  const text = parts.join(', ');
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

function translateOne(
  field: SemanticField,
  value: unknown,
  record: Record<string, unknown>,
  ctx: TranslationContext,
): string | null {
  if (field.type === 'crm_multifield') {
    return value && typeof value === 'object'
      ? scalar((value as Record<string, unknown>).VALUE)
      : null;
  }
  const raw = scalar(value);
  if (raw === null || raw === '') return null;

  if (field.options) {
    return field.options.find((option) => option.id === raw)?.label ?? null;
  }
  if (isBooleanField(field)) {
    if (raw === 'Y' || raw === '1') return 'Sim';
    if (raw === 'N' || raw === '0') return 'Não';
    return null;
  }
  if (field.type === 'user') {
    return ctx.users.get(raw) ?? null;
  }
  if (field.type === 'crm_category') {
    return ctx.metadata.pipelines.find((pipeline) => pipeline.id === Number(raw))?.name ?? null;
  }
  if (field.type === 'crm_stage') {
    return stageOf(ctx.metadata.pipelines, record.CATEGORY_ID, raw)?.etapa ?? null;
  }
  if (field.type === 'date') {
    // Só a data: o Bitrix manda meia-noite com fuso (`2026-10-19T03:00:00+03:00`).
    return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw;
  }
  if (field.type === 'money') {
    // Campo personalizado monetário: `1500.00|BRL`.
    const [amount, currency] = raw.split('|');
    return currency ? `${amount} ${currency}` : (amount ?? null);
  }
  if (field.code === 'OPPORTUNITY') {
    const currency = scalar(record.CURRENCY_ID);
    return currency ? `${raw} ${currency}` : raw;
  }
  return raw;
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export interface StageInfo {
  funil: string;
  etapa: string;
  situacao: string;
}

/** Funil, etapa e situação de um negócio pelos nomes do portal. */
export function stageOf(
  pipelines: Pipeline[],
  categoryId: unknown,
  stageId: unknown,
): StageInfo | null {
  const pipeline = pipelines.find((item) => item.id === Number(categoryId ?? 0));
  const stage = pipeline?.stages.find((item) => item.id === scalar(stageId));
  if (!pipeline || !stage) return null;
  return {
    funil: pipeline.name,
    etapa: stage.name,
    situacao: STAGE_SEMANTIC_LABELS[stage.semantic],
  };
}
