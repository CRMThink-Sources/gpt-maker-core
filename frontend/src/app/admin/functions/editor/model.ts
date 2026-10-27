import {
  type FunctionField,
  type FunctionOption,
  type FunctionTemplateContent,
  intentionJsonName,
} from '@gptmaker/contracts';

/**
 * Peças do editor visual de templates (design D12): criação de campos e opções com ids gerados
 * do rótulo e renomeação das referências enquanto o id ainda não foi publicado.
 */

export type FieldKind = FunctionField['kind'];
export type DraftIntention = FunctionTemplateContent['intentions'][number];
export type DraftAction = DraftIntention['actions'][number];
export type DraftTransfer = FunctionTemplateContent['transfers'][number];

export const KIND_LABELS: Record<FieldKind, string> = {
  TEXT: 'Texto',
  TEXT_LIST: 'Lista de textos',
  URL: 'Link',
  INTEGER: 'Número',
  BITRIX_USER: 'Usuário do Bitrix24',
  BITRIX_STAGE: 'Funil e etapa',
  BITRIX_OPENLINE: 'Canal aberto do Bitrix24',
  AGENT: 'Agente',
  CHOICE: 'Escolha única',
  MULTI_CHOICE: 'Múltipla escolha',
  KNOWLEDGE: 'Itens da base de conhecimento',
};

/** O que cada tipo de pergunta faz com a resposta: aparece ao escolher o tipo. */
export const KIND_HINTS: Record<FieldKind, string> = {
  TEXT: 'A resposta entra no texto do agente onde estiver o marcador.',
  TEXT_LIST: 'Cada item entra como um tópico (- item) no texto do agente.',
  URL: 'O link entra no texto do agente onde estiver o marcador.',
  INTEGER: 'Um número, útil nas ações (prazo, id de processo).',
  BITRIX_USER:
    'O cliente escolhe um usuário do Bitrix24 (ou vários, em rodízio). Use nas ações (responsável, atendente).',
  BITRIX_STAGE: 'O cliente escolhe funil e etapa. Use nas ações de negócio.',
  BITRIX_OPENLINE:
    'O cliente escolhe um canal aberto do portal. Use em "Transferir para atendente" com destino Canal aberto.',
  AGENT: 'O cliente escolhe outro agente do portal. Use numa transferência entre agentes.',
  CHOICE: 'O cliente escolhe uma opção; o texto da opção entra no agente.',
  MULTI_CHOICE: 'O cliente marca várias; os textos das marcadas entram juntos.',
  KNOWLEDGE: 'Não entra no texto: cada item vira um treinamento na base.',
};

/** Campos já publicados: tipo e valores das opções (visão do template). */
export type Published = Record<string, { kind: FieldKind; options: string[]; multiple?: boolean }>;

/** Parte de id a partir de um rótulo: `Canal de vendas` ⇒ `canal_de_vendas`. */
export function slug(label: string): string {
  const base = intentionJsonName(label) || 'campo';
  return /^[a-z]/.test(base) ? base : `c_${base}`;
}

export function makeId(prefix: string, label: string): string {
  return `${prefix}.${slug(label)}`;
}

/** Primeiro id livre: `x`, `x_2`, `x_3`... */
export function uniqueId(wanted: string, taken: ReadonlySet<string>): string {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) if (!taken.has(`${wanted}_${n}`)) return `${wanted}_${n}`;
}

export function newField(kind: FieldKind, id: string, label: string): FunctionField {
  const base = { id, label, required: true };
  switch (kind) {
    case 'TEXT':
      return { kind, ...base, maxLength: 200, multiline: false };
    case 'TEXT_LIST':
      return { kind, ...base, minItems: 1, maxItems: 5, itemMaxLength: 100 };
    case 'URL':
      return { kind, ...base, maxLength: 200 };
    case 'INTEGER':
      return { kind, ...base, min: 0, max: 30 };
    case 'BITRIX_USER':
      return { kind, ...base, multiple: false };
    case 'BITRIX_STAGE':
    case 'BITRIX_OPENLINE':
    case 'AGENT':
      return { kind, ...base };
    case 'CHOICE':
      return {
        kind,
        ...base,
        options: [newOption('Opção 1', []), newOption('Opção 2', ['opcao_1'])],
      };
    case 'MULTI_CHOICE':
      return {
        kind,
        ...base,
        options: [newOption('Opção 1', []), newOption('Opção 2', ['opcao_1'])],
        separator: '\n\n',
      };
    case 'KNOWLEDGE':
      return {
        kind,
        ...base,
        required: false,
        maxItems: 10,
        subfields: [
          { id: 'titulo', label: 'Título', required: true, maxLength: 100, multiline: false },
          { id: 'texto', label: 'Texto', required: true, maxLength: 800, multiline: true },
        ],
        format: '{{titulo}}\n{{texto}}',
      };
  }
}

export function newOption(label: string, taken: readonly string[]): FunctionOption {
  return { value: uniqueId(slug(label), new Set(taken)), label, snippet: label };
}

/** Todos os ids do conteúdo, inclusive dependentes (para não repetir). */
export function allIds(fields: readonly FunctionField[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: readonly FunctionField[]) => {
    for (const field of list) {
      ids.add(field.id);
      if (field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE') {
        for (const option of field.options) walk(option.dependents ?? []);
      }
    }
  };
  walk(fields);
  return ids;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Troca `{{de}}` e `{{de.parte}}` por `{{para...}}` num texto. */
function renameMarkers(text: string, from: string, to: string): string {
  return text.replace(
    new RegExp(`\\{\\{(\\s*)${escape(from)}(\\.[\\w.]+)?(\\s*)\\}\\}`, 'g'),
    (_match, before: string, part: string | undefined, after: string) =>
      `{{${before}${to}${part ?? ''}${after}}}`,
  );
}

/**
 * Renomeia um id em todo o conteúdo: marcadores em qualquer texto, condições e `collectFrom`.
 * Usado só enquanto o id não foi publicado.
 */
export function renameId<T>(value: T, from: string, to: string): T {
  const walk = (node: unknown, key?: string): unknown => {
    if (typeof node === 'string') {
      if ((key === 'field' || key === 'collectFrom') && node === from) return to;
      return renameMarkers(node, from, to);
    }
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    }
    return node;
  };
  return walk(value) as T;
}

/** Renomeia o valor de uma opção nas condições das intenções. */
export function renameOption(
  intentions: DraftIntention[],
  fieldId: string,
  from: string,
  to: string,
): DraftIntention[] {
  const fix = <C extends { field: string; in: string[] } | undefined>(condition: C): C =>
    condition && condition.field === fieldId
      ? ({ ...condition, in: condition.in.map((value) => (value === from ? to : value)) } as C)
      : condition;
  return intentions.map((intention) => ({
    ...intention,
    when: fix(intention.when),
    actions: intention.actions.map((action) => ({ ...action, when: fix(action.when) })),
  }));
}

export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
