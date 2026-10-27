import {
  type FunctionAnswers,
  type FunctionAnswerValue,
  type KnowledgeItem,
  renderKnowledgeItem,
  selectedValues,
} from './agent-function-answers';
import {
  FUNCTION_ADDITIONAL_INSTRUCTIONS_MAX,
  FUNCTION_BEHAVIOR_MAX,
  FUNCTION_COLLECTED_MARKER,
  FUNCTION_MARKER,
  type FunctionCondition,
  type FunctionField,
  type FunctionTemplateContent,
  flattenFields,
  isRuntimeMarker,
} from './agent-functions';
import type { AgentSettings } from './agents';
import type { z } from 'zod';
import { intentionInputSchema } from './intentions';

/**
 * Compilador da função (design D1): puro e determinístico, usado pelo frontend (contador e
 * prévia) e pelo backend (publicação). Respostas devem vir de `validateFunctionAnswers`.
 */

export type FunctionMode = 'SIMPLE' | 'ADVANCED' | 'TAKEN_OVER';

export interface CompileInput {
  content: FunctionTemplateContent;
  answers: FunctionAnswers;
  agentName: string;
  mode: FunctionMode;
  /** Modo avançado: anexadas ao fim do comportamento. */
  additionalInstructions?: string | null;
  /** Controle assumido: substitui o comportamento compilado. */
  takenOverBehavior?: string | null;
}

export interface CompiledTraining {
  /** `<campo>:<itemKey>`: liga o treinamento ao item entre publicações. */
  key: string;
  text: string;
}

export interface CompiledIntention {
  key: string;
  /** Já validada (saída do schema da intenção). */
  input: z.output<typeof intentionInputSchema>;
}

export interface CompiledAgent {
  behavior: string;
  /** Caracteres de cada parte do comportamento: texto fixo e cada marcador do template. */
  contributions: { fixed: number; markers: Record<string, number> };
  agentType: FunctionTemplateContent['agentType'];
  communicationType: 'FORMAL' | 'NORMAL' | 'RELAXED';
  profile: { jobName: string; jobDescription: string; jobSite: string };
  settings: AgentSettings;
  trainings: CompiledTraining[];
  intentions: CompiledIntention[];
  /** O agente precisa do acesso ao CRM (`crmAccess` do template ou de um bloco incluído). */
  crmAccess: boolean;
  /** Vazio ⇒ publicável. */
  errors: string[];
}

/** Profundidade máxima de trechos que citam campos que têm trechos. */
const MAX_DEPTH = 5;

/** Espaços no fim das linhas e mais de uma linha em branco seguida saem. */
export function normalizeBehavior(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

class Renderer {
  private readonly fields: Map<string, FunctionField>;

  constructor(
    content: FunctionTemplateContent,
    private readonly answers: FunctionAnswers,
    private readonly builtins: Record<string, string>,
  ) {
    this.fields = new Map(flattenFields(content.fields).map((field) => [field.id, field]));
  }

  /** Troca os marcadores de campos; os de execução ficam como estão. */
  render(text: string, extra: Record<string, string> = {}, depth = 0): string {
    return text.replace(FUNCTION_MARKER, (match, path: string) => {
      if (path in extra) return extra[path]!;
      if (isRuntimeMarker(path)) return match;
      return this.value(path, depth);
    });
  }

  /** Texto de um marcador. */
  value(path: string, depth = 0): string {
    if (path in this.builtins) return this.builtins[path]!;
    const field = this.fields.get(path);
    if (!field) {
      // Partes da seleção de funil: `{{campo.categoryId}}`, `{{campo.stageId}}`.
      const [id, part] = [
        path.slice(0, path.lastIndexOf('.')),
        path.slice(path.lastIndexOf('.') + 1),
      ];
      const stage = this.answers[id];
      if (
        this.fields.get(id)?.kind === 'BITRIX_STAGE' &&
        stage &&
        typeof stage === 'object' &&
        !Array.isArray(stage)
      ) {
        return part === 'categoryId'
          ? String(stage.categoryId)
          : part === 'stageId'
            ? stage.stageId
            : '';
      }
      return '';
    }
    return this.fieldText(field, this.answers[field.id], depth);
  }

  private fieldText(
    field: FunctionField,
    value: FunctionAnswerValue | undefined,
    depth: number,
  ): string {
    if (value === undefined) return '';
    switch (field.kind) {
      case 'TEXT':
      case 'URL':
        return typeof value === 'string' ? value : '';
      case 'INTEGER':
      case 'BITRIX_USER':
        return typeof value === 'number' ? String(value) : '';
      case 'BITRIX_STAGE':
        return typeof value === 'object' && !Array.isArray(value)
          ? `${value.categoryId}:${value.stageId}`
          : '';
      case 'TEXT_LIST':
        return selectedValues(value)
          .map((item) => `- ${item}`)
          .join('\n');
      case 'CHOICE':
      case 'MULTI_CHOICE': {
        if (depth >= MAX_DEPTH) return '';
        const chosen = selectedValues(value);
        const snippets = field.options
          .filter((option) => chosen.includes(option.value))
          .map((option) => this.render(option.snippet, {}, depth + 1));
        return snippets.join(field.kind === 'MULTI_CHOICE' ? field.separator : '');
      }
      case 'KNOWLEDGE':
        // Itens da base vão para os treinamentos, não para o comportamento.
        return '';
    }
  }
}

function conditionMet(condition: FunctionCondition | undefined, answers: FunctionAnswers): boolean {
  if (!condition) return true;
  return selectedValues(answers[condition.field]).some((value) => condition.in.includes(value));
}

/** Escolhas na ordem do formulário, com dependentes: as últimas prevalecem nos efeitos. */
function chosenOptions(fields: readonly FunctionField[], answers: FunctionAnswers) {
  return fields.flatMap(
    (field): Array<NonNullable<Extract<FunctionField, { kind: 'CHOICE' }>['options'][number]>> => {
      if (field.kind !== 'CHOICE' && field.kind !== 'MULTI_CHOICE') return [];
      const chosen = selectedValues(answers[field.id]);
      return field.options
        .filter((option) => chosen.includes(option.value))
        .flatMap((option) => [option, ...chosenOptions(option.dependents ?? [], answers)]);
    },
  );
}

/** Troca marcadores em todos os textos de uma configuração de ação. */
function renderConfig(value: unknown, render: (text: string) => string): unknown {
  if (typeof value === 'string') {
    const rendered = render(value);
    // Só um marcador que vira número (funil, usuário, prazo) ⇒ número.
    const single = new RegExp(`^${FUNCTION_MARKER.source}$`).test(value.trim());
    return single && /^\d+$/.test(rendered) ? Number(rendered) : rendered;
  }
  if (Array.isArray(value)) return value.map((item) => renderConfig(item, render));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderConfig(item, render)]),
    );
  }
  return value;
}

/** Nome do agente no limite do cadastro (`createAgentSchema`). */
const AGENT_NAME_MAX = 100;

/** Valor máximo de um campo que não é escolha (base fica de fora: não entra no comportamento). */
function maxValue(field: FunctionField): FunctionAnswerValue | undefined {
  switch (field.kind) {
    case 'TEXT':
    case 'URL':
      return 'x'.repeat(field.maxLength);
    case 'TEXT_LIST':
      return Array.from({ length: field.maxItems }, () => 'x'.repeat(field.itemMaxLength));
    case 'INTEGER':
      return String(field.min).length > String(field.max).length ? field.min : field.max;
    case 'BITRIX_USER':
      return 9_999_999;
    case 'BITRIX_STAGE':
      return { categoryId: 9_999, stageId: 'C9999:XXXXXXXXXXXX' };
    default:
      return undefined;
  }
}

export interface BudgetReport {
  /** Caracteres do comportamento no pior caso. */
  length: number;
  fixed: number;
  markers: Record<string, number>;
  /** Respostas que produzem o pior caso (para mostrar a prévia). */
  answers: FunctionAnswers;
}

/**
 * Pior caso do comportamento (spec agent-function-templates, "Validação de orçamento"): campos no
 * limite, a opção de trecho mais longo de cada escolha, todas as opções da múltipla escolha e
 * instruções adicionais no limite.
 */
export function worstCaseBudget(content: FunctionTemplateContent): BudgetReport {
  const answers: FunctionAnswers = {};
  const all = flattenFields(content.fields);
  for (const field of all) {
    const value = maxValue(field);
    if (value !== undefined) answers[field.id] = value;
  }
  // Múltipla escolha: tudo marcado. Escolha única: a que rende mais, uma de cada vez na ordem.
  for (const field of all) {
    if (field.kind === 'MULTI_CHOICE')
      answers[field.id] = field.options.map((option) => option.value);
  }
  for (const field of all) {
    if (field.kind !== 'CHOICE') continue;
    let best = { value: field.options[0]!.value, length: -1 };
    for (const option of field.options) {
      const renderer = new Renderer(content, { ...answers, [field.id]: option.value }, {});
      const length = renderer.value(field.id).length;
      if (length > best.length) best = { value: option.value, length };
    }
    answers[field.id] = best.value;
  }

  const compiled = compileAgent({
    content,
    answers,
    agentName: 'x'.repeat(AGENT_NAME_MAX),
    mode: 'ADVANCED',
    additionalInstructions: 'x'.repeat(FUNCTION_ADDITIONAL_INSTRUCTIONS_MAX),
  });
  return { length: compiled.behavior.length, ...compiled.contributions, answers };
}

export function compileAgent(input: CompileInput): CompiledAgent {
  const { content, answers } = input;
  const errors: string[] = [];
  const additional = input.mode === 'ADVANCED' ? (input.additionalInstructions ?? '').trim() : '';
  if (additional.length > FUNCTION_ADDITIONAL_INSTRUCTIONS_MAX) {
    errors.push(
      `as instruções adicionais passam de ${FUNCTION_ADDITIONAL_INSTRUCTIONS_MAX} caracteres`,
    );
  }
  const renderer = new Renderer(content, answers, {
    'agente.nome': input.agentName.trim(),
    'avancado.instrucoes_adicionais': additional,
  });

  // Comportamento e quanto cada marcador contribui.
  const markers: Record<string, number> = {};
  for (const [, path] of content.behavior.matchAll(FUNCTION_MARKER)) {
    markers[path!] = (markers[path!] ?? 0) + renderer.value(path!).length;
  }
  const fixed = content.behavior.replace(FUNCTION_MARKER, '').length;
  const compiled = normalizeBehavior(renderer.render(content.behavior));
  const behavior =
    input.mode === 'TAKEN_OVER' && input.takenOverBehavior != null
      ? input.takenOverBehavior.trim()
      : compiled;
  if (behavior.length > FUNCTION_BEHAVIOR_MAX) {
    const top = Object.entries(markers)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([path, length]) => `${path} (${length})`)
      .join(', ');
    errors.push(
      `o comportamento tem ${behavior.length} caracteres, ${behavior.length - FUNCTION_BEHAVIOR_MAX} acima do limite de ${FUNCTION_BEHAVIOR_MAX}; maiores partes: ${top}`,
    );
  }

  // Efeitos das escolhas sobre o tom e os settings.
  let communicationType: CompiledAgent['communicationType'] = 'NORMAL';
  let settings: AgentSettings = { ...content.settings };
  for (const option of chosenOptions(content.fields, answers)) {
    if (option.effects?.communicationType) communicationType = option.effects.communicationType;
    if (option.effects?.settings) settings = { ...settings, ...option.effects.settings };
  }

  // Um treinamento por item da base.
  const trainings: CompiledTraining[] = [];
  for (const field of flattenFields(content.fields)) {
    if (field.kind !== 'KNOWLEDGE') continue;
    const items = (answers[field.id] ?? []) as KnowledgeItem[];
    if (!Array.isArray(items)) continue;
    for (const item of items)
      trainings.push({
        key: `${field.id}:${item.itemKey}`,
        text: renderKnowledgeItem(field, item),
      });
  }
  const texts = trainings.map((training) => training.text);
  if (new Set(texts).size !== texts.length) errors.push('há itens da base com o mesmo texto');

  // Intenções ativadas pelas escolhas.
  const intentions: CompiledIntention[] = [];
  for (const intention of content.intentions) {
    if (!conditionMet(intention.when, answers)) continue;
    const collected = intention.collectFrom ? selectedValues(answers[intention.collectFrom]) : [];
    const extra = {
      [FUNCTION_COLLECTED_MARKER]: collected
        .map((question, index) => `${question}: {{fields.pergunta_${index + 1}}}`)
        .join('\n'),
    };
    const render = (text: string) => renderer.render(text, extra);
    const parsed = intentionInputSchema.safeParse({
      kind: 'BITRIX',
      name: render(intention.name),
      whenToUse: render(intention.whenToUse),
      fields: [
        ...(intention.fields ?? []).map((field) => ({
          ...field,
          description: render(field.description ?? ''),
        })),
        ...collected.map((question, index) => ({
          name: `Pergunta ${index + 1}`,
          description: question,
          type: 'STRING' as const,
          required: false,
        })),
      ],
      httpMethod: 'POST',
      actions: intention.actions
        .filter((action) => conditionMet(action.when, answers))
        .map((action) => ({ type: action.type, config: renderConfig(action.config, render) })),
      autoGenerateParams: false,
      autoGenerateBody: false,
      responseMode: intention.responseMode ?? 'INSTRUCTIONS',
      instructions: intention.instructions ? render(intention.instructions) : null,
      active: true,
    });
    if (parsed.success) intentions.push({ key: intention.key, input: parsed.data });
    else {
      errors.push(
        `intenção ${intention.key}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
      );
    }
  }

  return {
    behavior,
    contributions: { fixed, markers },
    agentType: content.agentType,
    communicationType,
    profile: {
      jobName: renderer.render(content.profile.jobName).trim(),
      jobDescription: renderer.render(content.profile.jobDescription).trim(),
      jobSite: renderer.render(content.profile.jobSite).trim(),
    },
    settings,
    trainings,
    intentions,
    // Versões gravadas antes do campo não o têm.
    crmAccess: content.crmAccess === true,
    errors,
  };
}
