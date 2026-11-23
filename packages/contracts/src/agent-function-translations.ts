import { z } from 'zod';
import type { FunctionField, FunctionTemplateContent } from './agent-functions';
import type { Locale } from './locale';

/**
 * Traduções do formulário das funções do agente (spec function-template-i18n, design D1): só o
 * que o cliente lê. O texto-base é o português; o texto que vai ao GPTMaker (comportamento,
 * trechos, intenções) não tem tradução. Tudo é chaveado por id, para sobreviver à reordenação.
 */

/** Idiomas com tradução; o português é o texto-base do template. */
export const FUNCTION_TRANSLATION_LOCALES = ['en', 'es'] as const;
export type FunctionTranslationLocale = (typeof FUNCTION_TRANSLATION_LOCALES)[number];

// Os limites repetem os do texto-base (`agent-functions.ts`): a tradução não pode estourar o campo.
const FIELD_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const SIMPLE_ID = /^[a-z][a-z0-9_]*$/;
const label = z.string().trim().min(1).max(120);
const help = z.string().trim().min(1).max(300);

const spaValueTranslationSchema = z.strictObject({
  label: label.optional(),
  help: help.optional(),
});

export const functionFieldTranslationSchema = z.strictObject({
  label: label.optional(),
  help: help.optional(),
  placeholder: z.string().trim().min(1).max(200).optional(),
  /** Rótulo de cada opção, pelo `value`. */
  options: z.record(z.string().regex(SIMPLE_ID), label).optional(),
  /** Rótulo de cada subcampo da base de conhecimento, pelo id. */
  subfields: z.record(z.string().regex(SIMPLE_ID), label).optional(),
  /** Rótulo e ajuda de cada valor do SPA, pelo id. */
  spaValues: z.record(z.string().regex(SIMPLE_ID), spaValueTranslationSchema).optional(),
  /** Mesma posição das perguntas do assistente de IA no texto-base. */
  // Vazio na posição que ainda não foi traduzida (a ordem das perguntas importa): cai no português.
  assistQuestions: z.array(z.string().trim().max(200)).max(5).optional(),
});
export type FunctionFieldTranslation = z.output<typeof functionFieldTranslationSchema>;

export const functionTemplateTranslationSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  /** Pelo id do campo, inclusive os dependentes e os vindos de blocos. */
  fields: z.record(z.string().regex(FIELD_ID), functionFieldTranslationSchema).optional(),
});
export type FunctionTemplateTranslation = z.output<typeof functionTemplateTranslationSchema>;

export const functionTranslationsSchema = z.strictObject({
  en: functionTemplateTranslationSchema.optional(),
  es: functionTemplateTranslationSchema.optional(),
});
export type FunctionTranslations = z.output<typeof functionTranslationsSchema>;

/** `en` ou `es`; qualquer outro idioma (inclusive `pt-BR`) usa o texto-base. */
export function translationLocale(
  locale: string | null | undefined,
): FunctionTranslationLocale | null {
  return (FUNCTION_TRANSLATION_LOCALES as readonly string[]).includes(locale ?? '')
    ? (locale as FunctionTranslationLocale)
    : null;
}

/** Campos e seus dependentes, na ordem do formulário (cópia local: evita ciclo de módulos). */
function allFields(fields: readonly FunctionField[]): FunctionField[] {
  return fields.flatMap((field) => [
    field,
    ...(field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE'
      ? field.options.flatMap((option) => allFields(option.dependents ?? []))
      : []),
  ]);
}

/** Texto traduzível: onde está, o texto-base e o caminho da tradução dentro de um idioma. */
export interface TranslatableText {
  /** Caminho legível, ex.: `fields.sdr.perfil_ideal.options.formal`. */
  path: string;
  /** Texto em português. */
  text: string;
  /** Chaves até a tradução dentro de `translations[idioma]` (índice numérico nas perguntas). */
  keys: Array<string | number>;
}

/** Textos que o cliente lê e que podem ter tradução, na ordem do formulário. */
export function translatableTexts(
  content: Pick<FunctionTemplateContent, 'fields'>,
  meta?: { name?: string; description?: string },
): TranslatableText[] {
  const texts: TranslatableText[] = [];
  const add = (path: string, text: string, keys: Array<string | number>) =>
    texts.push({ path, text, keys });
  if (meta?.name) add('name', meta.name, ['name']);
  if (meta?.description) add('description', meta.description, ['description']);
  for (const field of allFields(content.fields)) {
    const id = field.id;
    const base = ['fields', id];
    add(`fields.${id}.label`, field.label, [...base, 'label']);
    if (field.help) add(`fields.${id}.help`, field.help, [...base, 'help']);
    if ((field.kind === 'TEXT' || field.kind === 'TEXT_LIST') && field.placeholder) {
      add(`fields.${id}.placeholder`, field.placeholder, [...base, 'placeholder']);
    }
    if (field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE') {
      for (const option of field.options) {
        add(`fields.${id}.options.${option.value}`, option.label, [
          ...base,
          'options',
          option.value,
        ]);
      }
    }
    if (field.kind === 'KNOWLEDGE') {
      for (const subfield of field.subfields) {
        add(`fields.${id}.subfields.${subfield.id}`, subfield.label, [
          ...base,
          'subfields',
          subfield.id,
        ]);
      }
    }
    if (field.kind === 'BITRIX_SPA') {
      for (const value of field.values) {
        const at = [...base, 'spaValues', value.id];
        add(`fields.${id}.spaValues.${value.id}.label`, value.label, [...at, 'label']);
        if (value.help) add(`fields.${id}.spaValues.${value.id}.help`, value.help, [...at, 'help']);
      }
    }
    if (
      (field.kind === 'TEXT' || field.kind === 'TEXT_LIST' || field.kind === 'KNOWLEDGE') &&
      field.assist
    ) {
      field.assist.questions.forEach((question, index) =>
        add(`fields.${id}.assistQuestions.${index}`, question, [...base, 'assistQuestions', index]),
      );
    }
  }
  return texts;
}

/** Tradução atual de um texto neste idioma (`undefined` quando não há). */
export function translationOf(
  entry: FunctionTemplateTranslation | undefined,
  item: Pick<TranslatableText, 'keys'>,
): string | undefined {
  let node: unknown = entry;
  for (const key of item.keys) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string | number, unknown>)[key];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Cópia da tradução do idioma com o texto trocado. Valor vazio remove a tradução (e os
 * contêineres que ficarem vazios); na lista de perguntas, esvazia a posição e apara o fim.
 */
export function withTranslation(
  entry: FunctionTemplateTranslation | undefined,
  item: Pick<TranslatableText, 'keys'>,
  value: string,
): FunctionTemplateTranslation | undefined {
  const next = setIn(entry ?? {}, item.keys, value);
  return isEmptyNode(next) ? undefined : (next as FunctionTemplateTranslation);
}

function isEmptyNode(node: unknown): boolean {
  if (Array.isArray(node)) return node.length === 0;
  return node !== null && typeof node === 'object' && Object.keys(node).length === 0;
}

function setIn(node: unknown, keys: ReadonlyArray<string | number>, value: string): unknown {
  const [key, ...rest] = keys;
  if (key === undefined) return value.trim() === '' ? undefined : value;
  if (typeof key === 'number') {
    const list = Array.isArray(node) ? [...(node as unknown[])] : [];
    list[key] = setIn(list[key], rest, value);
    // Posição vazia no meio vira texto vazio (a ordem das perguntas importa); o fim é aparado.
    while (list.length > 0 && (list.at(-1) === undefined || list.at(-1) === '')) list.pop();
    return Array.from(list, (item) => item ?? '');
  }
  const copy: Record<string, unknown> = { ...(node as Record<string, unknown> | undefined) };
  const child = setIn(copy[key], rest, value);
  if (child === undefined || isEmptyNode(child)) delete copy[key];
  else copy[key] = child;
  return copy;
}

export interface TranslationCompleteness {
  locale: FunctionTranslationLocale;
  total: number;
  translated: number;
  /** Caminhos sem tradução. */
  missing: string[];
}

/** Quanto do formulário está traduzido em cada idioma (aviso no backoffice, nunca bloqueia). */
export function translationCompleteness(
  content: Pick<FunctionTemplateContent, 'fields' | 'translations'>,
  meta?: { name?: string; description?: string },
): TranslationCompleteness[] {
  const texts = translatableTexts(content, meta);
  return FUNCTION_TRANSLATION_LOCALES.map((locale) => {
    const entry = content.translations?.[locale];
    const missing = texts.filter((item) => !translationOf(entry, item)?.trim()).map((i) => i.path);
    return { locale, total: texts.length, translated: texts.length - missing.length, missing };
  });
}

/**
 * Problemas das traduções: id de campo, opção, subcampo ou valor de SPA que não existe no
 * formulário, e pergunta do assistente além das que o campo tem. Os limites de tamanho já saem do
 * schema. Vazio ⇒ válido.
 */
export function translationIssues(
  content: Pick<FunctionTemplateContent, 'fields' | 'translations'>,
): string[] {
  const issues: string[] = [];
  const byId = new Map(allFields(content.fields).map((field) => [field.id, field]));
  for (const locale of FUNCTION_TRANSLATION_LOCALES) {
    const fields = content.translations?.[locale]?.fields ?? {};
    for (const [id, entry] of Object.entries(fields)) {
      const where = `tradução ${locale}`;
      const field = byId.get(id);
      if (!field) {
        issues.push(`${where}: campo inexistente: ${id}`);
        continue;
      }
      const options =
        field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE'
          ? new Set(field.options.map((option) => option.value))
          : new Set<string>();
      for (const value of Object.keys(entry.options ?? {})) {
        if (!options.has(value)) issues.push(`${where}: opção inexistente em ${id}: ${value}`);
      }
      const subfields =
        field.kind === 'KNOWLEDGE'
          ? new Set(field.subfields.map((subfield) => subfield.id))
          : new Set<string>();
      for (const key of Object.keys(entry.subfields ?? {})) {
        if (!subfields.has(key)) issues.push(`${where}: subcampo inexistente em ${id}: ${key}`);
      }
      const spa =
        field.kind === 'BITRIX_SPA'
          ? new Set(field.values.map((value) => value.id))
          : new Set<string>();
      for (const key of Object.keys(entry.spaValues ?? {})) {
        if (!spa.has(key)) issues.push(`${where}: valor de SPA inexistente em ${id}: ${key}`);
      }
      const questions =
        (field.kind === 'TEXT' || field.kind === 'TEXT_LIST' || field.kind === 'KNOWLEDGE') &&
        field.assist
          ? field.assist.questions.length
          : 0;
      if ((entry.assistQuestions?.length ?? 0) > questions) {
        issues.push(`${where}: mais perguntas do assistente que as de ${id}`);
      }
    }
  }
  return issues;
}

/** Junta duas camadas de tradução; em conflito, `over` vence (template sobre bloco). */
export function mergeTranslations(
  base: FunctionTranslations | undefined,
  over: FunctionTranslations | undefined,
): FunctionTranslations | undefined {
  if (!base) return over;
  if (!over) return base;
  const merged: FunctionTranslations = {};
  for (const locale of FUNCTION_TRANSLATION_LOCALES) {
    const a = base[locale];
    const b = over[locale];
    if (!a && !b) continue;
    const fields = { ...a?.fields, ...b?.fields };
    merged[locale] = {
      ...a,
      ...b,
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    };
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Só as traduções de campos (o bloco não traduz nome nem descrição da função). */
export function fieldTranslationsOnly(
  translations: FunctionTranslations | undefined,
): FunctionTranslations | undefined {
  if (!translations) return undefined;
  const result: FunctionTranslations = {};
  for (const locale of FUNCTION_TRANSLATION_LOCALES) {
    const fields = translations[locale]?.fields;
    if (fields && Object.keys(fields).length > 0) result[locale] = { fields };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Traduções sem as dos campos de um bloco (caminho inverso de `mergeTranslations`). */
export function omitFieldTranslations(
  translations: FunctionTranslations | undefined,
  fieldIds: ReadonlySet<string>,
): FunctionTranslations | undefined {
  if (!translations) return undefined;
  const result: FunctionTranslations = {};
  for (const locale of FUNCTION_TRANSLATION_LOCALES) {
    const entry = translations[locale];
    if (!entry) continue;
    const fields = Object.fromEntries(
      Object.entries(entry.fields ?? {}).filter(([id]) => !fieldIds.has(id)),
    );
    const next: FunctionTemplateTranslation = { ...entry };
    if (Object.keys(fields).length > 0) next.fields = fields;
    else delete next.fields;
    if (Object.keys(next).length > 0) result[locale] = next;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function localizeField(
  field: FunctionField,
  entry: FunctionTemplateTranslation | undefined,
): FunctionField {
  const tr = entry?.fields?.[field.id];
  const base = {
    ...field,
    label: tr?.label ?? field.label,
    ...(tr?.help !== undefined || field.help !== undefined ? { help: tr?.help ?? field.help } : {}),
  };
  switch (field.kind) {
    case 'TEXT':
    case 'TEXT_LIST': {
      const placeholder = tr?.placeholder ?? field.placeholder;
      const assist = field.assist
        ? {
            ...field.assist,
            questions: field.assist.questions.map((q, index) => tr?.assistQuestions?.[index] || q),
          }
        : undefined;
      return {
        ...(base as typeof field),
        ...(placeholder !== undefined ? { placeholder } : {}),
        ...(assist ? { assist } : {}),
      };
    }
    case 'CHOICE':
    case 'MULTI_CHOICE':
      return {
        ...(base as typeof field),
        options: field.options.map((option) => ({
          ...option,
          label: tr?.options?.[option.value] ?? option.label,
          ...(option.dependents
            ? { dependents: option.dependents.map((dep) => localizeField(dep, entry)) }
            : {}),
        })),
      };
    case 'KNOWLEDGE': {
      const assist = field.assist
        ? {
            ...field.assist,
            questions: field.assist.questions.map((q, index) => tr?.assistQuestions?.[index] || q),
          }
        : undefined;
      return {
        ...(base as typeof field),
        subfields: field.subfields.map((subfield) => ({
          ...subfield,
          label: tr?.subfields?.[subfield.id] ?? subfield.label,
        })),
        ...(assist ? { assist } : {}),
      };
    }
    case 'BITRIX_SPA':
      return {
        ...(base as typeof field),
        values: field.values.map((value) => {
          const valueTr = tr?.spaValues?.[value.id];
          const valueHelp = valueTr?.help ?? value.help;
          return {
            ...value,
            label: valueTr?.label ?? value.label,
            ...(valueHelp !== undefined ? { help: valueHelp } : {}),
          };
        }),
      };
    default:
      return base as FunctionField;
  }
}

/**
 * Formulário no idioma pedido, com volta ao português por texto sem tradução. A resposta nunca
 * carrega `translations`, e ids, valores, limites e conteúdo do agente ficam como estão.
 */
export function localizeTemplateContent(
  content: FunctionTemplateContent,
  locale: Locale | string | null | undefined,
): FunctionTemplateContent {
  const { translations, ...rest } = content;
  const target = translationLocale(locale);
  const entry = target ? translations?.[target] : undefined;
  if (!entry) return rest;
  return { ...rest, fields: rest.fields.map((field) => localizeField(field, entry)) };
}

/** Nome e descrição da função no idioma pedido (texto-base quando não há tradução). */
export function localizeFunctionText(
  text: { name: string; description: string },
  translations: FunctionTranslations | undefined,
  locale: Locale | string | null | undefined,
): { name: string; description: string } {
  const target = translationLocale(locale);
  const entry = target ? translations?.[target] : undefined;
  return {
    name: entry?.name ?? text.name,
    description: entry?.description ?? text.description,
  };
}
