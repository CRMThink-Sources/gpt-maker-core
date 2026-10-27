import { z } from 'zod';
import { stableStringify } from './agent-function-plan';
import { agentSettingsSchema, agentTypeSchema, communicationTypeSchema } from './agents';
import { intentionFieldTypeSchema, intentionJsonName } from './intentions';
import { TEMPLATE_VARIABLES } from './templates';
import { TRAINING_TEXT_MAX } from './trainings';

/**
 * Templates de função do agente (spec agent-function-templates, design D2): o formulário que o
 * cliente responde e o texto que a compilação monta. Marcadores `{{campo}}` citam campos do
 * formulário; os de raiz de execução (`fields`, `contact`...) ficam para as intenções.
 */

/** Limite do comportamento no GPTMaker. */
export const FUNCTION_BEHAVIOR_MAX = 3000;
/** Instruções adicionais do modo avançado. */
export const FUNCTION_ADDITIONAL_INSTRUCTIONS_MAX = 400;

/** Marcadores resolvidos pela compilação, sem campo no formulário. */
export const FUNCTION_BUILTIN_MARKERS = ['agente.nome', 'avancado.instrucoes_adicionais'] as const;
/** Marcador das intenções que listam as respostas coletadas (`collectFrom`). */
export const FUNCTION_COLLECTED_MARKER = 'intencao.respostas';
/** Raízes resolvidas na execução da intenção, não na compilação (ver `templates.ts`). */
export const FUNCTION_RUNTIME_ROOTS = [
  'contact',
  'message',
  'agent',
  'event',
  'dialog',
  'interaction',
  'payload',
  'fields',
] as const;

/** `{{ caminho }}` sem valor padrão. */
export const FUNCTION_MARKER = /\{\{\s*([^{}|\s]+)\s*\}\}/g;

/** Caminhos citados num texto, na ordem e sem repetir. */
export function functionMarkers(text: string): string[] {
  return [...new Set([...text.matchAll(FUNCTION_MARKER)].map((match) => match[1]!))];
}

export function isRuntimeMarker(path: string): boolean {
  return (FUNCTION_RUNTIME_ROOTS as readonly string[]).includes(path.split('.')[0]!);
}

const FIELD_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const fieldId = z
  .string()
  .regex(FIELD_ID, 'use minúsculas separadas por ponto, como "sdr.perfil_ideal"')
  .refine((id) => !isRuntimeMarker(id), 'o id não pode começar por uma raiz de execução');

const label = z.string().trim().min(1).max(120);
const help = z.string().trim().max(300).optional();

/** Efeitos de uma opção fora do texto do comportamento. */
export const functionOptionEffectsSchema = z.object({
  communicationType: communicationTypeSchema.optional(),
  settings: agentSettingsSchema.optional(),
});

export type FunctionField =
  | {
      kind: 'TEXT';
      id: string;
      label: string;
      help?: string;
      required: boolean;
      maxLength: number;
      multiline: boolean;
      placeholder?: string;
    }
  | {
      kind: 'TEXT_LIST';
      id: string;
      label: string;
      help?: string;
      required: boolean;
      minItems: number;
      maxItems: number;
      itemMaxLength: number;
      placeholder?: string;
    }
  | { kind: 'URL'; id: string; label: string; help?: string; required: boolean; maxLength: number }
  | {
      kind: 'INTEGER';
      id: string;
      label: string;
      help?: string;
      required: boolean;
      min: number;
      max: number;
    }
  | {
      kind: 'BITRIX_USER';
      id: string;
      label: string;
      help?: string;
      required: boolean;
      /** Vários usuários: nas ações, cada execução vai para o próximo da lista (design D15). */
      multiple: boolean;
    }
  | { kind: 'BITRIX_STAGE'; id: string; label: string; help?: string; required: boolean }
  /** Canal aberto do Bitrix24 (id da configuração da Linha Aberta), para transferir (D16). */
  | { kind: 'BITRIX_OPENLINE'; id: string; label: string; help?: string; required: boolean }
  /** Outro agente do portal, destino de uma transferência entre agentes (D17). */
  | { kind: 'AGENT'; id: string; label: string; help?: string; required: boolean }
  | {
      kind: 'CHOICE';
      id: string;
      label: string;
      help?: string;
      required: boolean;
      options: FunctionOption[];
    }
  | {
      kind: 'MULTI_CHOICE';
      id: string;
      label: string;
      help?: string;
      required: boolean;
      options: FunctionOption[];
      separator: string;
    }
  | {
      kind: 'KNOWLEDGE';
      id: string;
      label: string;
      help?: string;
      required: boolean;
      maxItems: number;
      subfields: FunctionKnowledgeSubfield[];
      /** Texto do treinamento de cada item, com `{{subcampo}}`. */
      format: string;
    };

export interface FunctionOption {
  value: string;
  label: string;
  /** Texto que entra no comportamento quando a opção está escolhida. */
  snippet: string;
  /** Campos exibidos e exigidos só com a opção escolhida. */
  dependents?: FunctionField[];
  effects?: z.infer<typeof functionOptionEffectsSchema>;
}

export interface FunctionKnowledgeSubfield {
  id: string;
  label: string;
  required: boolean;
  maxLength: number;
  multiline: boolean;
}

const optionValue = z.string().regex(/^[a-z][a-z0-9_]*$/, 'use minúsculas, números e _');
const subfieldId = z.string().regex(/^[a-z][a-z0-9_]*$/, 'use minúsculas, números e _');

const knowledgeSubfieldSchema = z.object({
  id: subfieldId,
  label,
  required: z.boolean(),
  maxLength: z.number().int().min(1).max(TRAINING_TEXT_MAX),
  multiline: z.boolean().default(false),
});

const base = { id: fieldId, label, help, required: z.boolean() };

export const functionOptionSchema: z.ZodType<FunctionOption> = z.lazy(() =>
  z.object({
    value: optionValue,
    label,
    snippet: z.string().trim().min(1, 'escreva o trecho da opção').max(FUNCTION_BEHAVIOR_MAX),
    dependents: z.array(functionFieldSchema).max(10).optional(),
    effects: functionOptionEffectsSchema.optional(),
  }),
);

const options = z
  .array(functionOptionSchema)
  .min(1)
  .max(10)
  .refine(
    (list) => new Set(list.map((option) => option.value)).size === list.length,
    'há opções com o mesmo valor',
  );

export const functionFieldSchema: z.ZodType<FunctionField> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('TEXT'),
      ...base,
      maxLength: z.number().int().min(1).max(FUNCTION_BEHAVIOR_MAX),
      multiline: z.boolean().default(false),
      placeholder: z.string().max(200).optional(),
    }),
    z
      .object({
        kind: z.literal('TEXT_LIST'),
        ...base,
        minItems: z.number().int().min(0).max(20),
        maxItems: z.number().int().min(1).max(20),
        itemMaxLength: z.number().int().min(1).max(1000),
        placeholder: z.string().max(200).optional(),
      })
      .refine((field) => field.minItems <= field.maxItems, 'minItems maior que maxItems'),
    z.object({
      kind: z.literal('URL'),
      ...base,
      /** Links entram no comportamento: o limite entra no pior caso do orçamento. */
      maxLength: z.number().int().min(10).max(2000).default(200),
    }),
    z
      .object({ kind: z.literal('INTEGER'), ...base, min: z.number().int(), max: z.number().int() })
      .refine((field) => field.min <= field.max, 'min maior que max'),
    z.object({ kind: z.literal('BITRIX_USER'), ...base, multiple: z.boolean().default(false) }),
    z.object({ kind: z.literal('BITRIX_STAGE'), ...base }),
    z.object({ kind: z.literal('BITRIX_OPENLINE'), ...base }),
    z.object({ kind: z.literal('AGENT'), ...base }),
    z.object({ kind: z.literal('CHOICE'), ...base, options }),
    z.object({
      kind: z.literal('MULTI_CHOICE'),
      ...base,
      options,
      /** Entre os trechos das opções marcadas: linha em branco (seções) ou ', ' (itens). */
      separator: z.string().max(10).default('\n\n'),
    }),
    z.object({
      kind: z.literal('KNOWLEDGE'),
      ...base,
      maxItems: z.number().int().min(1).max(50),
      subfields: z.array(knowledgeSubfieldSchema).min(1).max(6),
      format: z.string().min(1).max(500),
    }),
  ]),
);

/** Condição de uma intenção ou ação: o campo de escolha tem um destes valores. */
const conditionSchema = z.object({ field: fieldId, in: z.array(optionValue).min(1) });
export type FunctionCondition = z.infer<typeof conditionSchema>;

/**
 * Intenção gerada pela função. As ações são as da intenção `BITRIX` (`triggers.ts`), com
 * marcadores de campos; números (funil, usuário) aceitam o marcador como texto, convertido na
 * compilação. A ação inteira é validada depois de compilada.
 */
export const functionIntentionSchema = z.object({
  /** Chave estável: liga a intenção gerada ao registro local entre publicações. */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().trim().min(1).max(255),
  whenToUse: z.string().trim().min(1).max(512),
  when: conditionSchema.optional(),
  fields: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        description: z.string().trim().max(500).default(''),
        type: intentionFieldTypeSchema,
        required: z.boolean(),
      }),
    )
    .max(20)
    .default([]),
  /** Lista de textos cujos itens viram campos coletados (`pergunta_1`...), com o texto como descrição. */
  collectFrom: fieldId.optional(),
  actions: z
    .array(
      z.object({
        when: conditionSchema.optional(),
        type: z.string(),
        config: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(10),
  responseMode: z.enum(['API', 'INSTRUCTIONS']).default('INSTRUCTIONS'),
  instructions: z.string().trim().max(5000).nullable().default(null),
});
export type FunctionIntention = z.input<typeof functionIntentionSchema>;

/**
 * Transferência para outro agente (design D17): vira uma regra de transferência do agente no
 * GPTMaker. `agent` é o marcador sozinho de um campo `AGENT`; `instructions` diz quando transferir.
 */
export const functionTransferSchema = z.object({
  /** Chave estável: liga a regra gerada ao registro local entre publicações. */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  when: conditionSchema.optional(),
  agent: z.string().trim().min(1).max(200),
  instructions: z.string().trim().min(1).max(1000),
  /** A conversa volta ao agente de origem quando o atendimento do destino termina. */
  returnOnFinish: z.boolean().default(false),
});
export type FunctionTransfer = z.input<typeof functionTransferSchema>;

/** Conteúdo de uma versão publicada: blocos já expandidos (design D3). */
export const functionTemplateContentSchema = z.object({
  agentType: agentTypeSchema,
  /** Settings derivados da função; as escolhas podem sobrescrever (`effects`). */
  settings: agentSettingsSchema.default({}),
  /** Dados da empresa enviados ao GPTMaker, com marcadores. */
  profile: z.object({
    jobName: z.string().max(200).default(''),
    jobDescription: z.string().max(500).default(''),
    jobSite: z.string().max(200).default(''),
  }),
  fields: z.array(functionFieldSchema).min(1).max(40),
  behavior: z.string().min(1).max(FUNCTION_BEHAVIOR_MAX),
  intentions: z.array(functionIntentionSchema).max(10).default([]),
  transfers: z.array(functionTransferSchema).max(5).default([]),
  /**
   * Exige o acesso ao CRM do agente (intenção de sistema "Consultar cliente no CRM" e servidor
   * MCP, spec agent-crm-tools): a publicação no agente o ativa, se ainda não estiver ativo.
   */
  crmAccess: z.boolean().default(false),
});
export type FunctionTemplateContent = z.output<typeof functionTemplateContentSchema>;
export type FunctionTemplateContentInput = z.input<typeof functionTemplateContentSchema>;

/** Bloco compartilhado: campos no início do formulário, intenções e um trecho `{{bloco.<código>}}`. */
export const functionBlockContentSchema = z.object({
  fields: z.array(functionFieldSchema).max(20).default([]),
  behavior: z.string().max(FUNCTION_BEHAVIOR_MAX).default(''),
  intentions: z.array(functionIntentionSchema).max(5).default([]),
  transfers: z.array(functionTransferSchema).max(5).default([]),
  /** Template que inclui o bloco passa a exigir o acesso ao CRM (`crmAccess` do template). */
  crmAccess: z.boolean().default(false),
});
export type FunctionBlockContent = z.output<typeof functionBlockContentSchema>;
export type FunctionBlockContentInput = z.input<typeof functionBlockContentSchema>;

export const functionCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'use maiúsculas e _');
export const blockCodeSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'use minúsculas e _');

/** Rascunho editado no backoffice: o conteúdo mais os blocos incluídos. */
export const functionTemplateDraftSchema = functionTemplateContentSchema.extend({
  blocks: z.array(blockCodeSchema).max(10).default([]),
});
export type FunctionTemplateDraft = z.output<typeof functionTemplateDraftSchema>;
export type FunctionTemplateDraftInput = z.input<typeof functionTemplateDraftSchema>;

type ChoiceField = Extract<FunctionField, { kind: 'CHOICE' | 'MULTI_CHOICE' }>;

/** Todos os campos, com os dependentes, na ordem do formulário. */
export function flattenFields(fields: readonly FunctionField[]): FunctionField[] {
  return fields.flatMap((field) => [
    field,
    ...(field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE'
      ? field.options.flatMap((option) => flattenFields(option.dependents ?? []))
      : []),
  ]);
}

/** Textos de uma intenção onde marcadores podem aparecer. */
function intentionTexts(intention: FunctionIntention): string[] {
  const texts: string[] = [intention.name, intention.whenToUse, intention.instructions ?? ''];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') texts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  intention.actions.forEach((action) => walk(action.config));
  intention.fields?.forEach((field) => texts.push(field.description ?? ''));
  return texts;
}

/** Onde está um problema do template, para o editor do backoffice destacar o lugar (design D12). */
export interface TemplateIssueWhere {
  section: 'general' | 'form' | 'behavior' | 'actions';
  fieldId?: string;
  option?: string;
  intentionKey?: string;
  actionIndex?: number;
}

export interface TemplateIssue {
  where: TemplateIssueWhere;
  message: string;
}

/**
 * Problemas estruturais do conteúdo (já expandido), com o lugar de cada um: ids repetidos,
 * marcadores sem campo, trecho citando campo inexistente, condição em campo que não é escolha.
 * Vazio ⇒ válido.
 */
export function templateIssues(content: FunctionTemplateContent): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const add = (where: TemplateIssueWhere, message: string) => issues.push({ where, message });
  const all = flattenFields(content.fields);
  const byId = new Map<string, FunctionField>();
  for (const field of all) {
    if (byId.has(field.id))
      add({ section: 'form', fieldId: field.id }, `campo repetido: ${field.id}`);
    byId.set(field.id, field);
  }
  // Dependente ⇒ a escolha onde ele está e as opções que o mostram.
  const parents = new Map<string, { field: ChoiceField; options: string[] }>();
  for (const field of all) {
    if (field.kind !== 'CHOICE' && field.kind !== 'MULTI_CHOICE') continue;
    for (const option of field.options) {
      for (const dependent of option.dependents ?? []) {
        const entry = parents.get(dependent.id) ?? { field, options: [] };
        entry.options.push(option.value);
        parents.set(dependent.id, entry);
      }
    }
  }
  const known = new Set<string>([...byId.keys(), ...FUNCTION_BUILTIN_MARKERS]);
  // Partes de seleção do funil: `{{campo.categoryId}}`, `{{campo.stageId}}`.
  for (const field of all) {
    if (field.kind === 'BITRIX_STAGE') {
      known.add(`${field.id}.categoryId`);
      known.add(`${field.id}.stageId`);
    }
  }

  const check = (
    text: string,
    label: string,
    where: TemplateIssueWhere,
    extra: readonly string[] = [],
  ) => {
    for (const marker of functionMarkers(text)) {
      if (isRuntimeMarker(marker) || known.has(marker) || extra.includes(marker)) continue;
      add(where, `marcador sem campo em ${label}: {{${marker}}}`);
    }
  };

  check(content.behavior, 'comportamento', { section: 'behavior' });
  check(content.profile.jobName, 'perfil', { section: 'general' });
  check(content.profile.jobDescription, 'perfil', { section: 'general' });
  check(content.profile.jobSite, 'perfil', { section: 'general' });
  for (const field of all) {
    if (field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE') {
      for (const option of field.options) {
        check(option.snippet, `opção ${field.id}=${option.value}`, {
          section: 'form',
          fieldId: field.id,
          option: option.value,
        });
      }
    }
    if (field.kind === 'KNOWLEDGE') {
      const subfields = field.subfields.map((subfield) => subfield.id);
      for (const marker of functionMarkers(field.format)) {
        if (!subfields.includes(marker)) {
          add(
            { section: 'form', fieldId: field.id },
            `subcampo inexistente no formato de ${field.id}: {{${marker}}}`,
          );
        }
      }
    }
  }

  // Dependente que nenhum texto cita: o valor que o cliente informa não iria para lugar algum.
  const used = new Set<string>([
    ...functionMarkers(content.behavior),
    ...all.flatMap((field) =>
      field.kind === 'CHOICE' || field.kind === 'MULTI_CHOICE'
        ? field.options.flatMap((option) => functionMarkers(option.snippet))
        : [],
    ),
    ...content.intentions.flatMap((intention) => [
      ...intentionTexts(intention).flatMap(functionMarkers),
      ...[intention.when, ...intention.actions.map((action) => action.when)].flatMap((condition) =>
        condition ? [condition.field] : [],
      ),
    ]),
    ...(content.transfers ?? []).flatMap((transfer) => [
      ...functionMarkers(transfer.agent),
      ...functionMarkers(transfer.instructions),
      ...(transfer.when ? [transfer.when.field] : []),
    ]),
  ]);
  for (const field of all) {
    if (field.kind !== 'CHOICE' && field.kind !== 'MULTI_CHOICE') continue;
    for (const option of field.options) {
      for (const dependent of option.dependents ?? []) {
        const cited = [...used].some(
          (marker) => marker === dependent.id || marker.startsWith(`${dependent.id}.`),
        );
        if (!cited) {
          add(
            { section: 'form', fieldId: dependent.id },
            `campo dependente sem uso: ${dependent.id}`,
          );
        }
      }
    }
  }

  const keys = new Set<string>();
  for (const intention of content.intentions) {
    const at = (actionIndex?: number): TemplateIssueWhere =>
      actionIndex === undefined
        ? { section: 'actions', intentionKey: intention.key }
        : { section: 'actions', intentionKey: intention.key, actionIndex };
    if (keys.has(intention.key)) add(at(), `intenção repetida: ${intention.key}`);
    keys.add(intention.key);
    const extra = intention.collectFrom ? [FUNCTION_COLLECTED_MARKER] : [];
    const label = `intenção ${intention.key}`;
    for (const text of [
      intention.name,
      intention.whenToUse,
      intention.instructions ?? '',
      ...(intention.fields ?? []).map((field) => field.description ?? ''),
    ]) {
      check(text, label, at(), extra);
    }
    intention.actions.forEach((action, index) => {
      for (const text of configTexts(action.config)) check(text, label, at(index), extra);
    });
    const conditions: Array<[FunctionCondition | undefined, number | undefined]> = [
      [intention.when, undefined],
      ...intention.actions.map((action, index): [FunctionCondition | undefined, number] => [
        action.when,
        index,
      ]),
    ];
    for (const [condition, index] of conditions) {
      if (!condition) continue;
      const field = byId.get(condition.field);
      if (!field || (field.kind !== 'CHOICE' && field.kind !== 'MULTI_CHOICE')) {
        add(
          at(index),
          `condição da intenção ${intention.key} cita campo que não é escolha: ${condition.field}`,
        );
        continue;
      }
      for (const value of condition.in) {
        if (!field.options.some((option) => option.value === value)) {
          add(
            at(index),
            `condição da intenção ${intention.key} cita opção inexistente: ${condition.field}=${value}`,
          );
        }
      }
    }
    if (intention.collectFrom && byId.get(intention.collectFrom)?.kind !== 'TEXT_LIST') {
      add(at(), `intenção ${intention.key}: collectFrom precisa citar uma lista de textos`);
    }
    if (
      (intention.responseMode ?? 'INSTRUCTIONS') === 'INSTRUCTIONS' &&
      !intention.instructions?.trim()
    ) {
      add(at(), `${intention.name}: escreva a instrução depois da ação`);
    }
    // Passo que usa um dependente: sem a opção dele escolhida, o valor fica vazio e a ação não
    // compila (ex.: responsável de uma tarefa). A condição da ação ou do passo tem de garantir a opção.
    intention.actions.forEach((action, index) => {
      const cited = new Set(
        configTexts(action.config)
          .flatMap(functionMarkers)
          .map((marker) => marker.replace(/\.(categoryId|stageId)$/, '')),
      );
      for (const id of cited) {
        const parent = parents.get(id);
        if (!parent) continue;
        const guarantees = (condition?: FunctionCondition) =>
          condition?.field === parent.field.id &&
          condition.in.every((value) => parent.options.includes(value));
        if (guarantees(intention.when) || guarantees(action.when)) continue;
        const labels = parent.field.options
          .filter((option) => parent.options.includes(option.value))
          .map((option) => option.label)
          .join(' ou ');
        add(
          at(index),
          `${intention.name} usa "${byId.get(id)!.label}", que só existe com "${parent.field.label}" = ${labels}: ponha essa condição na ação ou no passo`,
        );
      }
    });
  }

  // Transferências entre agentes (D17): como as intenções, endereçadas pela chave.
  const transferKeys = new Set<string>();
  for (const transfer of content.transfers ?? []) {
    const at: TemplateIssueWhere = { section: 'actions', intentionKey: transfer.key };
    const label = `transferência ${transfer.key}`;
    if (transferKeys.has(transfer.key)) add(at, `transferência repetida: ${transfer.key}`);
    transferKeys.add(transfer.key);
    const agentField = /^\{\{\s*([^{}|\s]+)\s*\}\}$/.exec(transfer.agent.trim())?.[1];
    if (!agentField || byId.get(agentField)?.kind !== 'AGENT') {
      add(at, `${label}: escolha um campo de agente`);
    }
    check(transfer.instructions, label, at);
    if (transfer.when) {
      const field = byId.get(transfer.when.field);
      if (!field || (field.kind !== 'CHOICE' && field.kind !== 'MULTI_CHOICE')) {
        add(at, `condição da ${label} cita campo que não é escolha: ${transfer.when.field}`);
      } else {
        for (const value of transfer.when.in) {
          if (!field.options.some((option) => option.value === value)) {
            add(at, `condição da ${label} cita opção inexistente: ${transfer.when.field}=${value}`);
          }
        }
      }
    }
    // Dependente sem a condição dele: sem a opção escolhida, a regra ficaria sem agente.
    for (const id of new Set([
      ...functionMarkers(transfer.agent),
      ...functionMarkers(transfer.instructions),
    ])) {
      const parent = parents.get(id);
      if (!parent) continue;
      const condition = transfer.when;
      if (
        condition?.field === parent.field.id &&
        condition.in.every((value) => parent.options.includes(value))
      ) {
        continue;
      }
      const labels = parent.field.options
        .filter((option) => parent.options.includes(option.value))
        .map((option) => option.label)
        .join(' ou ');
      add(
        at,
        `Transferência ${transfer.key} usa "${byId.get(id)!.label}", que só existe com "${parent.field.label}" = ${labels}: ponha essa condição na transferência`,
      );
    }
  }
  return issues;
}

/** Só as mensagens (API e testes): ver `templateIssues`. */
export function functionTemplateErrors(content: FunctionTemplateContent): string[] {
  return templateIssues(content).map((issue) => issue.message);
}

/** Textos de uma configuração de ação. */
function configTexts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(configTexts);
  if (value && typeof value === 'object') return Object.values(value).flatMap(configTexts);
  return [];
}

/** Campo que só faz sentido nas ações: canal aberto e usuários em rodízio. */
function actionOnly(field: FunctionField): boolean {
  return field.kind === 'BITRIX_OPENLINE' || (field.kind === 'BITRIX_USER' && field.multiple);
}

/** Ponto do template onde um texto com marcadores é escrito (design D12). */
export type MarkerContext =
  { kind: 'behavior' } | { kind: 'snippet' } | { kind: 'intention'; key: string };

export interface MarkerOption {
  marker: string;
  label: string;
}

const BUILTIN_LABELS: Record<(typeof FUNCTION_BUILTIN_MARKERS)[number], string> = {
  'agente.nome': 'Nome do agente',
  'avancado.instrucoes_adicionais': 'Instruções adicionais (modo avançado)',
};

/**
 * Marcadores que valem num ponto do template, para o editor oferecer: campos do formulário (fora
 * os da base), partes do funil, marcadores do sistema e os blocos incluídos (no rascunho). Nos
 * textos de intenção, também as variáveis da execução e os campos coletados.
 */
export function availableMarkers(
  content: Pick<FunctionTemplateContent, 'fields' | 'intentions'>,
  context: MarkerContext,
  options: { blocks?: readonly string[] } = {},
): MarkerOption[] {
  const markers: MarkerOption[] = [];
  for (const field of flattenFields(content.fields)) {
    if (field.kind === 'KNOWLEDGE') continue;
    // Agente, canal e vários usuários servem às ações, não ao texto (D15–D17).
    if (field.kind === 'AGENT') continue;
    if (context.kind !== 'intention' && actionOnly(field)) continue;
    if (field.kind === 'BITRIX_STAGE') {
      markers.push({ marker: `${field.id}.categoryId`, label: `${field.label} (funil)` });
      markers.push({ marker: `${field.id}.stageId`, label: `${field.label} (etapa)` });
      continue;
    }
    markers.push({ marker: field.id, label: field.label });
  }
  for (const marker of FUNCTION_BUILTIN_MARKERS) {
    markers.push({ marker, label: BUILTIN_LABELS[marker] });
  }
  if (context.kind !== 'intention') {
    for (const code of options.blocks ?? []) {
      markers.push({ marker: `bloco.${code}`, label: `Texto do bloco ${code}` });
    }
    return markers;
  }

  const intention = content.intentions.find((item) => item.key === context.key);
  if (intention?.collectFrom) {
    markers.push({ marker: FUNCTION_COLLECTED_MARKER, label: 'Perguntas e respostas coletadas' });
  }
  for (const field of intention?.fields ?? []) {
    markers.push({
      marker: `fields.${intentionJsonName(field.name)}`,
      label: `Coletado: ${field.name}`,
    });
  }
  for (const variable of TEMPLATE_VARIABLES) {
    markers.push({ marker: variable.path, label: variable.description });
  }
  return markers;
}

/**
 * Expande os blocos do rascunho (design D3): campos dos blocos no início do formulário, intenções
 * ao fim, e `{{bloco.<código>}}` trocado pelo texto do bloco em todo o conteúdo.
 */
export function expandBlocks(
  draft: FunctionTemplateDraft,
  blocks: ReadonlyMap<string, FunctionBlockContent>,
): { content: FunctionTemplateContent; errors: string[] } {
  const errors: string[] = [];
  const included: FunctionBlockContent[] = [];
  for (const code of draft.blocks) {
    const block = blocks.get(code);
    if (block) included.push(block);
    else errors.push(`bloco inexistente: ${code}`);
  }
  const replaceBlocks = (text: string) =>
    text.replace(/\{\{\s*bloco\.([a-z][a-z0-9_]*)\s*\}\}/g, (match, code: string) => {
      const block = draft.blocks.includes(code) ? blocks.get(code) : undefined;
      if (!block) {
        errors.push(`bloco não incluído no template: ${code}`);
        return match;
      }
      return block.behavior;
    });

  const content: FunctionTemplateContent = {
    agentType: draft.agentType,
    settings: draft.settings,
    profile: draft.profile,
    behavior: replaceBlocks(draft.behavior),
    fields: [...included.flatMap((block) => block.fields), ...draft.fields],
    intentions: [...draft.intentions, ...included.flatMap((block) => block.intentions)].map(
      (intention) => ({
        ...intention,
        whenToUse: replaceBlocks(intention.whenToUse),
        instructions: intention.instructions ? replaceBlocks(intention.instructions) : null,
      }),
    ),
    // Rascunhos e blocos gravados antes das transferências (D17) não têm a lista.
    transfers: [...(draft.transfers ?? []), ...included.flatMap((block) => block.transfers ?? [])],
    crmAccess: draft.crmAccess || included.some((block) => block.crmAccess),
  };
  return { content, errors };
}

/**
 * Caminho inverso de `expandBlocks`: rascunho com os blocos de `current` que, expandido, dá
 * exatamente `content` (uma versão publicada). Os trechos dos blocos voltam a ser
 * `{{bloco.<código>}}`. Nulo quando não reproduz a versão ou perde um `{{bloco.<código>}}` que o
 * rascunho atual usa, por exemplo se um bloco mudou depois dela: a versão guarda os blocos
 * expandidos (design D3) e o texto antigo ficaria copiado, sem receber correções do bloco.
 */
export function collapseBlocks(
  content: FunctionTemplateContent,
  current: FunctionTemplateDraft,
  blocks: ReadonlyMap<string, FunctionBlockContent>,
): FunctionTemplateDraft | null {
  const blockCodes = current.blocks;
  const included = blockCodes.map((code) => blocks.get(code));
  if (included.some((block) => !block)) return null;
  const blockFields = included.flatMap((block) => block!.fields).length;
  const blockIntentions = included.flatMap((block) => block!.intentions).length;
  const blockTransfers = included.flatMap((block) => block!.transfers ?? []).length;
  const collapse = (text: string) =>
    blockCodes.reduce((acc, code) => {
      const behavior = blocks.get(code)!.behavior;
      return behavior ? acc.split(behavior).join(`{{bloco.${code}}}`) : acc;
    }, text);
  const draft: FunctionTemplateDraft = {
    agentType: content.agentType,
    settings: content.settings,
    profile: content.profile,
    blocks: [...blockCodes],
    behavior: collapse(content.behavior),
    fields: content.fields.slice(blockFields),
    intentions: content.intentions
      .slice(0, content.intentions.length - blockIntentions)
      .map((intention) => ({
        ...intention,
        whenToUse: collapse(intention.whenToUse),
        instructions: intention.instructions ? collapse(intention.instructions) : null,
      })),
    transfers: (content.transfers ?? []).slice(
      0,
      (content.transfers ?? []).length - blockTransfers,
    ),
    // Bloco que exige o CRM já liga o acesso na expansão: o rascunho não precisa marcar.
    crmAccess: included.some((block) => block!.crmAccess) ? false : content.crmAccess,
  };
  const blockMarkers = (text: string) => text.match(/\{\{\s*bloco\.[a-z][a-z0-9_]*\s*\}\}/g) ?? [];
  const kept = new Set(blockMarkers(draft.behavior).map((marker) => marker.replace(/\s/g, '')));
  if (blockMarkers(current.behavior).some((marker) => !kept.has(marker.replace(/\s/g, '')))) {
    return null;
  }
  const { content: expanded, errors } = expandBlocks(draft, blocks);
  return errors.length === 0 && stableStringify(expanded) === stableStringify(content)
    ? draft
    : null;
}

/** Função como o app a mostra para escolher (só versões publicadas). */
export interface AgentFunctionView {
  code: string;
  name: string;
  description: string;
  version: number;
}
