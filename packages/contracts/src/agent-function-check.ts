import type { FunctionAnswers, FunctionAnswerValue } from './agent-function-answers';
import { type BudgetReport, compileAgent, worstCaseBudget } from './agent-function-compiler';
import {
  FUNCTION_BEHAVIOR_MAX,
  type FunctionField,
  type FunctionTemplateContent,
  flattenFields,
  type TemplateIssue,
  templateIssues,
} from './agent-functions';

/** Item de exemplo da base nas compilações de checagem. */
const SAMPLE_ITEM_KEY = '00000000-0000-4000-8000-000000000000';

function sampleValue(field: FunctionField): FunctionAnswerValue | undefined {
  switch (field.kind) {
    case 'TEXT':
      return 'Exemplo';
    case 'URL':
      return 'https://exemplo.com.br';
    case 'TEXT_LIST':
      return Array.from({ length: Math.max(1, field.minItems) }, (_, index) => `Item ${index + 1}`);
    case 'INTEGER':
      return field.min;
    case 'BITRIX_USER':
      return 1;
    case 'BITRIX_STAGE':
      return { categoryId: 1, stageId: 'C1:NEW' };
    case 'CHOICE':
      return field.options[0]!.value;
    case 'MULTI_CHOICE':
      return field.options.map((option) => option.value);
    case 'KNOWLEDGE':
      return [
        {
          itemKey: SAMPLE_ITEM_KEY,
          values: Object.fromEntries(field.subfields.map((subfield) => [subfield.id, 'Exemplo'])),
        },
      ];
  }
}

type Choices = ReadonlyMap<string, FunctionAnswerValue>;

/** Respostas como o cliente as daria: dependente só tem valor com a opção dele escolhida. */
function sampleAnswers(fields: readonly FunctionField[], choices: Choices, into: FunctionAnswers) {
  for (const field of fields) {
    const value = choices.get(field.id) ?? sampleValue(field);
    if (value === undefined) continue;
    into[field.id] = value;
    if (field.kind !== 'CHOICE' && field.kind !== 'MULTI_CHOICE') continue;
    const chosen: unknown[] = Array.isArray(value) ? value : [value];
    for (const option of field.options) {
      if (chosen.includes(option.value)) sampleAnswers(option.dependents ?? [], choices, into);
    }
  }
  return into;
}

/**
 * Respostas de exemplo: uma base (primeira opção de cada escolha única, todas as de múltipla) e uma
 * variação por opção de cada escolha, inclusive as dependentes (com as opções acima forçadas para
 * ela aparecer). Assim uma ação que usa um dependente sem a condição dele falha na checagem.
 */
export function sampleAnswerSets(content: FunctionTemplateContent): FunctionAnswers[] {
  const pick = (field: FunctionField, value: string): FunctionAnswerValue =>
    field.kind === 'MULTI_CHOICE' ? [value] : value;
  // Escolha ⇒ opções acima dela que a fazem aparecer.
  const path = new Map<string, Array<[string, FunctionAnswerValue]>>();
  const walk = (fields: readonly FunctionField[], above: Array<[string, FunctionAnswerValue]>) => {
    for (const field of fields) {
      if (field.kind !== 'CHOICE' && field.kind !== 'MULTI_CHOICE') continue;
      path.set(field.id, above);
      for (const option of field.options)
        walk(option.dependents ?? [], [...above, [field.id, pick(field, option.value)]]);
    }
  };
  walk(content.fields, []);
  const sets = [sampleAnswers(content.fields, new Map(), {})];
  for (const field of flattenFields(content.fields)) {
    if (field.kind !== 'CHOICE' && field.kind !== 'MULTI_CHOICE') continue;
    const options = field.kind === 'CHOICE' ? field.options.slice(1) : field.options;
    for (const option of options) {
      const choices = new Map(path.get(field.id));
      choices.set(field.id, pick(field, option.value));
      sets.push(sampleAnswers(content.fields, choices, {}));
    }
  }
  return sets;
}

export interface TemplateCheck {
  errors: string[];
  /** Os mesmos problemas, com o lugar de cada um (editor do backoffice, design D12). */
  issues: TemplateIssue[];
  budget: BudgetReport;
}

/** Intenção citada no erro da compilação (`intenção <chave>: ...`). */
const INTENTION_ERROR = /^intenção ([a-z][a-z0-9_]*): /;

/**
 * Checagem para publicar uma versão (spec agent-function-templates): estrutura, orçamento no pior
 * caso e as intenções compiladas em cada variação de escolha. Vazio em `errors` ⇒ publicável.
 */
export function checkTemplate(content: FunctionTemplateContent): TemplateCheck {
  const issues = templateIssues(content);
  // Com problema de estrutura a compilação não diz nada útil; pior caso estourado, sim.
  const compiles = issues.length === 0;
  const budget = worstCaseBudget(content);
  if (budget.length > FUNCTION_BEHAVIOR_MAX) {
    const parts = Object.entries(budget.markers)
      .filter(([, length]) => length > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([path, length]) => `${path}: ${length}`)
      .join(', ');
    issues.push({
      where: { section: 'behavior' },
      message: `pior caso do comportamento com ${budget.length} caracteres (limite ${FUNCTION_BEHAVIOR_MAX}); texto fixo: ${budget.fixed}; ${parts}`,
    });
  }
  if (compiles) {
    for (const answers of sampleAnswerSets(content)) {
      const compiled = compileAgent({ content, answers, agentName: 'Agente', mode: 'SIMPLE' });
      for (const message of compiled.errors) {
        if (issues.some((issue) => issue.message === message)) continue;
        const key = INTENTION_ERROR.exec(message)?.[1];
        issues.push({
          where: key ? { section: 'actions', intentionKey: key } : { section: 'behavior' },
          message,
        });
      }
    }
  }
  return { errors: issues.map((issue) => issue.message), issues, budget };
}
