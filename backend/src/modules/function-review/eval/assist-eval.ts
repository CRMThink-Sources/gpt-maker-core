import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AssistModelOutput,
  assistModelOutputSchema,
  flattenFields,
} from '@gptmaker/contracts';
import { z } from 'zod';
import { type AssistableField, assistMessages, toAssistResult } from '../assist-prompt';
import { numbersIn } from './eval-metrics';
import type { Chat } from './eval-runner';
import { loadSeedTemplate } from './eval-template';

/**
 * Avaliação da ajuda da IA: roda sob demanda, com chave real, fora do CI (como a da revisão); o CI
 * só valida o conjunto de casos e o avaliador puro. Mede se a ajuda inventa fato ou passa do limite.
 */

export const assistCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Código do template do seed de onde vem o campo. */
  template: z.enum(['SDR', 'SUPPORT']),
  fieldId: z.string().min(1),
  /** Entrevista completa, vazia ou respondida com "não sei". */
  kind: z.enum(['complete', 'empty', 'unknown']),
  about: z.string().min(20),
  /** Perguntas de `assist` do campo (o seed ainda não as declara). */
  questions: z.array(z.string().min(1)).min(1).max(5),
  interview: z.array(z.object({ question: z.string(), answer: z.string() })).max(5),
});
export type AssistCase = z.infer<typeof assistCaseSchema>;

export function loadAssistCases(): AssistCase[] {
  const raw = JSON.parse(readFileSync(join(__dirname, 'assist-cases.json'), 'utf8')) as unknown;
  return z.array(assistCaseSchema).parse(raw);
}

/** Campo de texto do seed, com as perguntas do caso como `assist`. */
export function assistFieldOf(testCase: AssistCase): AssistableField {
  const template = loadSeedTemplate(testCase.template);
  const field = flattenFields(template.fields).find((entry) => entry.id === testCase.fieldId);
  if (!field || (field.kind !== 'TEXT' && field.kind !== 'TEXT_LIST')) {
    throw new Error(`campo de texto não encontrado: ${testCase.fieldId}`);
  }
  return { ...field, assist: { questions: testCase.questions } };
}

export interface AssistEvaluation {
  inventedFacts: string[];
  overLimit: boolean;
  markers: number;
}

const MARKER = /\[preencher:[^\]]*\]/gi;
const TIME_TERMS =
  /\b(segunda|terça|quarta|quinta|sexta|sábado|domingo|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/giu;

/** Nome próprio: palavra com inicial maiúscula fora do começo de frase (sigla toda em maiúsculas não conta). */
function properNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/\p{Lu}[\p{L}\d]+/gu)) {
    const word = match[0];
    if (word === word.toUpperCase()) continue;
    const before = text.slice(0, match.index).trimEnd();
    if (before === '' || /[.!?:;\n\-•(]$/.test(before)) continue;
    names.push(word);
  }
  return names;
}

/** Fatos da saída (número, preço, prazo, nome próprio) que não estão em `about` nem nas respostas. */
function inventedFactsIn(texts: string[], sources: string): string[] {
  const known = sources.toLowerCase();
  const knownNumbers = numbersIn(sources);
  const invented = new Set<string>();
  for (const raw of texts) {
    const text = raw.replace(MARKER, ' ');
    for (const number of numbersIn(text)) if (!knownNumbers.has(number)) invented.add(number);
    for (const term of text.toLowerCase().match(TIME_TERMS) ?? []) {
      if (!known.includes(term)) invented.add(term);
    }
    for (const name of properNames(text)) {
      if (!known.includes(name.toLowerCase())) invented.add(name);
    }
  }
  return [...invented];
}

export function evaluateAssistCase(
  testCase: AssistCase,
  output: AssistModelOutput,
): AssistEvaluation {
  const field = assistFieldOf(testCase);
  const result = toAssistResult([field], output)[0]!;
  const texts = typeof result.value === 'string' ? [result.value] : (result.value as string[]);
  const sources = [testCase.about, ...testCase.interview.map((entry) => entry.answer)].join('\n');
  return {
    inventedFacts: inventedFactsIn(texts, sources),
    // Campo que a IA não devolveu vira vazio: não é passar do limite.
    overLimit: !result.applicable && texts.some((text) => text.trim() !== ''),
    markers: result.markers,
  };
}

export interface AssistCaseReport {
  id: string;
  failed: number;
  inventedFacts: string[];
  overLimit: number;
  markers: number;
  output: string[];
}

export interface AssistReport {
  perCase: AssistCaseReport[];
  inventedFacts: number;
  overLimit: number;
  failed: number;
}

/** Como o serviço: saída fora do formato ganha uma nova tentativa; depois conta como falha. */
async function askAssist(chat: Chat, testCase: AssistCase) {
  const field = assistFieldOf(testCase);
  const template = loadSeedTemplate(testCase.template);
  const messages = assistMessages({
    fields: [field],
    about: testCase.about,
    interview: [{ fieldId: field.id, answers: testCase.interview }],
    context: {
      functionName: template.name,
      functionDescription: template.description,
      agentName: 'Agente de teste',
    },
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const content = await chat(messages);
    try {
      const checked = assistModelOutputSchema.safeParse(JSON.parse(content));
      if (checked.success) return { output: checked.data, content };
    } catch {
      // saída que não é JSON: tenta de novo
    }
  }
  return null;
}

export async function runAssistEval(
  cases: AssistCase[],
  chat: Chat,
  repeat: number,
): Promise<AssistReport> {
  const perCase: AssistCaseReport[] = [];
  for (const testCase of cases) {
    const entry: AssistCaseReport = {
      id: testCase.id,
      failed: 0,
      inventedFacts: [],
      overLimit: 0,
      markers: 0,
      output: [],
    };
    for (let run = 0; run < repeat; run++) {
      const answer = await askAssist(chat, testCase);
      if (!answer) {
        entry.failed++;
        continue;
      }
      const evaluation = evaluateAssistCase(testCase, answer.output);
      entry.inventedFacts.push(...evaluation.inventedFacts);
      if (evaluation.overLimit) entry.overLimit++;
      entry.markers += evaluation.markers;
      entry.output.push(answer.content);
    }
    perCase.push(entry);
  }
  const sum = (pick: (entry: AssistCaseReport) => number) =>
    perCase.reduce((total, entry) => total + pick(entry), 0);
  return {
    perCase,
    inventedFacts: sum((entry) => entry.inventedFacts.length),
    overLimit: sum((entry) => entry.overLimit),
    failed: sum((entry) => entry.failed),
  };
}

export function formatAssistReport(report: AssistReport): string {
  const rows = [
    ['caso', 'fatos inventados', 'acima do limite', 'marcadores', 'falhas'],
    ...report.perCase.map((entry) => [
      entry.id,
      entry.inventedFacts.length
        ? `${entry.inventedFacts.length} (${entry.inventedFacts.join(', ')})`
        : '0',
      String(entry.overLimit),
      String(entry.markers),
      String(entry.failed),
    ]),
    [
      'total',
      String(report.inventedFacts),
      String(report.overLimit),
      String(report.perCase.reduce((sum, entry) => sum + entry.markers, 0)),
      String(report.failed),
    ],
  ];
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  return rows.map((row) => row.map((cell, col) => cell.padEnd(widths[col]!)).join('  ')).join('\n');
}
