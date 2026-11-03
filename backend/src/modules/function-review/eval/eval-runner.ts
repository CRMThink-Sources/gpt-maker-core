import {
  flattenFields,
  type FunctionAnswers,
  reviewableFields,
  reviewCrossResultSchema,
  reviewModelFieldOutputSchema,
} from '@gptmaker/contracts';
import type { z } from 'zod';
import type { VibecodeMessage } from '../../vibecode';
import {
  crossMessages,
  fieldMessages,
  type FieldPromptContext,
  otherBaseTitles,
  type ReviewableField,
  type ReviewItem,
  reviewItems,
  toFieldResult,
} from '../review-prompt';
import { baselineFieldMessages } from './baseline-prompt';
import { type EvalCase, type EvalTemplate, toAnswers } from './eval-case';
import {
  type CaseRun,
  type CaseScore,
  numbersIn,
  SCORE_KEYS,
  scoreCase,
  sumScores,
} from './eval-metrics';

/** Pergunta ao modelo e devolve o texto da resposta; no script é o Vibecode, nos testes é um dublê. */
export type Chat = (messages: VibecodeMessage[]) => Promise<string>;

export interface PromptVersion {
  name: string;
  field: (
    field: ReviewableField,
    items: ReviewItem[],
    context: FieldPromptContext,
  ) => VibecodeMessage[];
}

/**
 * Versões do pedido por campo que o avaliador sabe montar. `current` é o que roda em produção;
 * `baseline` é o de antes da mudança `agent-review-quality`. Para testar uma ideia nova, copie
 * `current` para `candidate` e mude só o que quer medir.
 */
export function buildPrompts(version: string): PromptVersion {
  switch (version) {
    case 'current':
    case 'candidate':
      return { name: version, field: fieldMessages };
    case 'baseline':
      return { name: version, field: baselineFieldMessages };
    default:
      throw new Error(`versão desconhecida: ${version} (use current, candidate ou baseline)`);
  }
}

function parse<S extends z.ZodType>(schema: S, content: string): z.output<S> | null {
  try {
    const checked = schema.safeParse(JSON.parse(content));
    return checked.success ? checked.data : null;
  } catch {
    return null;
  }
}

/** Como o serviço: saída fora do formato ganha uma nova tentativa; depois disso conta como falha. */
async function ask<S extends z.ZodType>(
  chat: Chat,
  messages: VibecodeMessage[],
  schema: S,
  counter: { calls: number; last?: string },
): Promise<z.output<S> | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    counter.calls++;
    const content = await chat(messages);
    counter.last = content;
    const output = parse(schema, content);
    if (output) return output;
  }
  return null;
}

export async function runCase(
  version: PromptVersion,
  testCase: EvalCase,
  template: EvalTemplate,
  chat: Chat,
): Promise<CaseRun> {
  const answers: FunctionAnswers = toAnswers(testCase);
  const counter: { calls: number; last?: string } = { calls: 0 };
  const knowledge = flattenFields(template.fields).filter(
    (field): field is Extract<typeof field, { kind: 'KNOWLEDGE' }> => field.kind === 'KNOWLEDGE',
  );
  const run: CaseRun = { fields: [], contradictions: [], failed: [], rawFailures: [], calls: 0 };
  const summaries: Array<{ fieldId: string; label: string; summary: string }> = [];

  for (const field of reviewableFields(template, answers)) {
    if (field.kind !== 'TEXT' && field.kind !== 'TEXT_LIST' && field.kind !== 'KNOWLEDGE') continue;
    const items = reviewItems(field, answers);
    const output = await ask(
      chat,
      version.field(field, items, {
        functionName: template.name,
        agentName: 'Agente de teste',
        functionDescription: template.description,
        otherTitles: otherBaseTitles(knowledge, answers, field.id),
      }),
      reviewModelFieldOutputSchema,
      counter,
    );
    if (!output) {
      run.failed.push(field.id);
      run.rawFailures.push({ fieldId: field.id, content: counter.last ?? '' });
      continue;
    }
    const result = toFieldResult(field, items, output);
    run.fields.push({ fieldId: field.id, items, result });
    summaries.push({ fieldId: field.id, label: field.label, summary: result.summary });
  }

  if (testCase.crossFields && summaries.length >= 2) {
    const output = await ask(chat, crossMessages(summaries), reviewCrossResultSchema, counter);
    const byLabel = new Map(
      summaries.map((entry) => [entry.label.trim().toLowerCase(), entry.fieldId]),
    );
    const known = new Set(summaries.map((entry) => entry.fieldId));
    const toId = (ref: string) => (known.has(ref) ? ref : byLabel.get(ref.trim().toLowerCase()));
    run.contradictions = (output?.contradictions ?? []).map((entry) => ({
      text: entry.text,
      fields: entry.fields.map(toId).filter((id): id is string => id !== undefined),
    }));
  }
  run.calls = counter.calls;
  return run;
}

export interface VersionReport {
  version: string;
  perCase: Array<{ id: string; type: string; score: CaseScore; details: string[] }>;
  total: CaseScore;
}

/** Roda a versão em todos os casos, `repeat` vezes cada (a IA não é determinística). */
export async function runVersion(
  version: PromptVersion,
  cases: EvalCase[],
  template: EvalTemplate,
  chat: Chat,
  repeat = 2,
): Promise<VersionReport> {
  const perCase: VersionReport['perCase'] = [];
  for (const testCase of cases) {
    const scores: CaseScore[] = [];
    const details: string[] = [];
    for (let i = 0; i < repeat; i++) {
      const run = await runCase(version, testCase, template, chat);
      scores.push(scoreCase(testCase, run));
      details.push(describeRun(testCase, run));
    }
    perCase.push({ id: testCase.id, type: testCase.type, score: sumScores(scores), details });
  }
  return { version: version.name, perCase, total: sumScores(perCase.map((entry) => entry.score)) };
}

/** O que a IA devolveu num caso, em texto: problemas, sugestões (com os números novos) e falhas. */
export function describeRun(testCase: EvalCase, run: CaseRun): string {
  const lines: string[] = [];
  for (const failure of run.rawFailures) {
    lines.push(`  [sem resposta válida] ${failure.fieldId}: ${failure.content.slice(0, 500)}`);
  }
  for (const entry of run.fields) {
    for (const item of entry.result.items) {
      for (const problem of item.problems) {
        lines.push(
          `  ${entry.fieldId}#${item.index} ${problem.severity}/${problem.category}: ${problem.text}`,
        );
      }
      if (item.suggestion) {
        const original = entry.items.find((candidate) => candidate.index === item.index);
        const known = numbersIn(Object.values(original?.values ?? {}).join('\n'));
        const text = Object.values(item.suggestion.values).join(' | ');
        const novos = [...numbersIn(text)].filter((n) => !known.has(n));
        const marks = `${novos.length ? ` [números novos: ${novos.join(', ')}]` : ''}${item.suggestion.applicable ? '' : ' [fora do limite]'}`;
        lines.push(`  ${entry.fieldId}#${item.index} sugestão${marks}: ${text.slice(0, 300)}`);
      }
    }
  }
  for (const contradiction of run.contradictions) {
    lines.push(`  contradição ${contradiction.fields.join(' x ')}: ${contradiction.text}`);
  }
  const wanted = testCase.expected
    .map(
      (e) =>
        `${e.fieldId}#${e.itemIndex} ${e.categories.join('|')}${e.severity ? `/${e.severity}` : ''}`,
    )
    .join('; ');
  return `${testCase.id} (esperado: ${wanted || 'nada'})$\n${lines.join('\n') || '  (sem problemas)'}`;
}

const LABELS: Record<(typeof SCORE_KEYS)[number], string> = {
  expected: 'problemas esperados',
  foundItem: 'achados no item certo',
  found: 'achados com a categoria certa',
  extra: 'problemas a mais',
  overLimit: 'sugestões acima do limite',
  invented: 'sugestões com número inventado',
  onlyMarker: 'sugestões que trocam o texto só por marcador',
  obeyed: 'instrução escondida obedecida',
  crossExpected: 'contradições esperadas',
  crossFound: 'contradições achadas',
  failed: 'campos sem resposta válida',
  calls: 'chamadas',
};

/** Melhor quando maior (achados) ou menor (erros e custo), para marcar a diferença. */
const HIGHER_IS_BETTER = new Set<(typeof SCORE_KEYS)[number]>(['foundItem', 'found', 'crossFound']);

/** Tabela de texto: uma coluna por versão e, com duas, a diferença. */
export function formatReport(reports: VersionReport[]): string {
  const rows = SCORE_KEYS.map((key) => {
    const values = reports.map((report) => report.total[key]);
    const delta =
      reports.length === 2
        ? (() => {
            const diff = values[1]! - values[0]!;
            if (diff === 0) return '=';
            const better = HIGHER_IS_BETTER.has(key) ? diff > 0 : diff < 0;
            return `${diff > 0 ? '+' : ''}${diff} ${better ? '(melhor)' : '(pior)'}`;
          })()
        : '';
    return [LABELS[key], ...values.map(String), delta];
  });
  const header = [
    'métrica',
    ...reports.map((report) => report.version),
    ...(reports.length === 2 ? ['diferença'] : []),
  ];
  const table = [header, ...rows.map((row) => (reports.length === 2 ? row : row.slice(0, -1)))];
  const widths = header.map((_, col) => Math.max(...table.map((row) => (row[col] ?? '').length)));
  return table
    .map((row) => row.map((cell, col) => cell.padEnd(widths[col]!)).join('  '))
    .join('\n');
}
