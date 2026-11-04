import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AssistModelOutput,
  assistModelOutputSchema,
  flattenFields,
} from '@gptmaker/contracts';
import { z } from 'zod';
import { type AssistableField, assistMessages, toAssistResult } from '../assist-prompt';
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
  /**
   * Entrevista completa, vazia ou respondida com "não sei". `skeleton` (só na base) roda a ajuda no
   * modo esqueleto, com a entrevista completa: a IA não pode redigir conteúdo.
   */
  kind: z.enum(['complete', 'empty', 'unknown', 'skeleton']),
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

/** Campo de texto ou base do seed, com as perguntas do caso como `assist`. */
export function assistFieldOf(testCase: AssistCase): AssistableField {
  const template = loadSeedTemplate(testCase.template);
  const field = flattenFields(template.fields).find((entry) => entry.id === testCase.fieldId);
  if (
    !field ||
    (field.kind !== 'TEXT' && field.kind !== 'TEXT_LIST' && field.kind !== 'KNOWLEDGE')
  ) {
    throw new Error(`campo de texto ou base não encontrado: ${testCase.fieldId}`);
  }
  return { ...field, assist: { questions: testCase.questions } };
}

export interface AssistEvaluation {
  inventedFacts: string[];
  overLimit: boolean;
  markers: number;
  /** Modo esqueleto: subcampos além do título com texto que não é marcador, como a IA devolveu. */
  skeletonViolations: number;
}

const MARKER = /\[preencher:[^\]]*\]/gi;

/** Minúsculas e sem acento, para comparar palavras sem depender de grafia. */
function norm(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const wordsOf = (text: string): string[] => norm(text).match(/[\p{L}\d]+/gu) ?? [];

/**
 * Números do texto como fichas: "45", "5000", "1.299,90" (preço, sem o R$) e "14h30" (hora, uma
 * ficha só). Dígito colado numa palavra (Bitrix24) é nome, não quantidade. Em texto gerado a
 * numeração de lista só vale no começo da linha ("1. ", "1) "); "R$ 5000. Depois" conta.
 */
function numberTokens(text: string, stripListNumbering: boolean): Set<string> {
  const body = stripListNumbering ? text.replace(/^[ \t]*\d+[.)][ \t]+/gm, '') : text;
  return new Set(body.match(/(?<![\p{L}\d])(?:\d+h\d+|\d+(?:[.,]\d+)*)/gu) ?? []);
}

/** Dia da semana e mês: prazo que o cliente não disse. */
const TIME_TERMS = [
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
  'domingo',
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Números por extenso (sem acento). "um/uma" ficam de fora: são artigo (ver SPELLED_ONE). */
const SPELLED_NUMBERS = [
  'dois',
  'duas',
  'tres',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'catorze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
  'cem',
  'cento',
  'duzentos',
  'duzentas',
  'trezentos',
  'trezentas',
  'quatrocentos',
  'quatrocentas',
  'quinhentos',
  'quinhentas',
  'seiscentos',
  'seiscentas',
  'setecentos',
  'setecentas',
  'oitocentos',
  'oitocentas',
  'novecentos',
  'novecentas',
  'mil',
  'duzia',
];

/**
 * "um/uma" só é fato logo antes de uma unidade de tempo ou de valor. Ficam de fora dia, vez e as
 * unidades de contagem (cliente, vendedor): "um dia", "de uma vez" e "um cliente" são fala comum.
 */
const SPELLED_ONE_UNITS = [
  'semana',
  'semanas',
  'mes',
  'meses',
  'ano',
  'anos',
  'hora',
  'horas',
  'minuto',
  'minutos',
  'real',
  'reais',
];

/**
 * Palavras comuns (sem acento) que abrem frase ou item: artigos, preposições, pronomes, conjunções,
 * advérbios, verbos do vocabulário do prompt e palavras típicas de campo de agente. Só valem no
 * começo de frase: no meio dela, palavra com inicial maiúscula é checada contra o texto do cliente.
 */
const COMMON_OPENERS = new Set(
  [
    'o a os as um uma uns umas de da do das dos em no na nos nas por pelo pela para pra com sem sobre ate ao aos',
    'eu voce voces ele ela eles elas isso isto esse essa este esta aquele aquela',
    'nosso nossa nossos nossas seu sua seus suas meu minha',
    'e ou mas se quando como que onde porque enquanto caso apos antes depois',
    'quem qual quais quanto quanta quantos quantas tambem todo toda todos todas cada',
    'nao sim ja so ha ola nunca sempre seja',
    'pergunte perguntar atenda encaminhe transfira oriente responda registre colete confirme explique ajude use',
    'envie informe peca verifique identifique agende fale diga tente evite faca solicite ofereca',
    'cumprimente mantenha',
    'qualificado qualificada cliente clientes lead leads empresa empresas assunto assuntos',
    'fecha atende custa paga fala tem quer usa vende compra precisa busca possui trabalha',
    'cancelamento pedido pedidos atendimento suporte time equipe pos horario preco',
  ]
    .join(' ')
    .split(/\s+/)
    .map(norm),
);

/** Terminações de verbo na 1ª pessoa do plural ("Atendemos", "Fazemos", "Trabalhamos", "Partimos"). */
const FIRST_PERSON_PLURAL = /(emos|amos|imos)$/;

/** Marca ou produto: letra maiúscula no meio ("WhatsApp", "HubSpot") ou dígito ("Bitrix24"). */
const BRAND_LIKE = /\p{Ll}\p{Lu}|\d/u;

/**
 * Palavra comum de começo de frase: a forma minúscula, sem o plural ("s", "es") ou com ele, aparece
 * como palavra inteira nas fontes ("Donos" quando o cliente escreveu "dono").
 */
function inSourcesAsCommonNoun(plain: string, knownWords: Set<string>): boolean {
  if (knownWords.has(plain) || knownWords.has(`${plain}s`) || knownWords.has(`${plain}es`)) {
    return true;
  }
  return (
    (plain.endsWith('s') && knownWords.has(plain.slice(0, -1))) ||
    (plain.endsWith('es') && knownWords.has(plain.slice(0, -2)))
  );
}

/**
 * Nome próprio: palavra com inicial maiúscula (sigla toda em maiúsculas não conta). No meio da frase
 * vale sempre. No começo de frase ou de item (primeira palavra) só conta se não for palavra comum:
 * fora da lista de abridores, sem forma de verbo na 1ª pessoa do plural e sem aparecer em minúsculas
 * no texto do mesmo caso; marca com maiúscula no meio ou dígito conta sempre.
 */
function properNames(text: string, lowercased: Set<string>, knownWords: Set<string>): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/\p{Lu}[\p{L}\d]+/gu)) {
    const word = match[0];
    if (word === word.toUpperCase()) continue;
    // Aspas de abertura e marcas de markdown antes da palavra não a tiram do começo da frase.
    const before = text.slice(0, match.index).replace(/[ \t"“”‘’'«»*#_>]+$/u, '');
    const atStart =
      before.trim() === '' ||
      /[.!?:;\n\-•(]$/.test(before) ||
      /(?:^|\n)[ \t]*\d+[.)]$/.test(before);
    if (atStart && !BRAND_LIKE.test(word)) {
      const plain = norm(word);
      if (
        COMMON_OPENERS.has(plain) ||
        FIRST_PERSON_PLURAL.test(plain) ||
        lowercased.has(plain) ||
        inSourcesAsCommonNoun(plain, knownWords)
      ) {
        continue;
      }
    }
    names.push(word);
  }
  return names;
}

/** Fatos da saída (número, preço, hora, prazo, nome próprio) que não estão em `about` nem nas respostas. */
function inventedFactsIn(texts: string[], sources: string): string[] {
  const knownWords = new Set(wordsOf(sources));
  const knownNumbers = numberTokens(sources, false);
  const invented = new Set<string>();
  const lowercased = new Set(
    texts.flatMap((raw) => (raw.match(/(?<![\p{L}\d])\p{Ll}[\p{L}\d]*/gu) ?? []).map(norm)),
  );
  for (const raw of texts) {
    const text = raw.replace(MARKER, ' ');
    for (const number of numberTokens(text, true)) {
      if (!knownNumbers.has(number)) invented.add(number);
    }
    const words = wordsOf(text);
    words.forEach((word, index) => {
      const spelled =
        (SPELLED_NUMBERS.includes(word) && !(word === 'cento' && words[index - 1] === 'por')) ||
        TIME_TERMS.includes(word) ||
        ((word === 'um' || word === 'uma') && SPELLED_ONE_UNITS.includes(words[index + 1] ?? ''));
      if (spelled && !knownWords.has(word)) invented.add(word);
    });
    for (const name of properNames(text, lowercased, knownWords)) {
      if (!knownWords.has(norm(name))) invented.add(name);
    }
  }
  return [...invented];
}

const ONLY_MARKER = /^\s*\[preencher:[^\]]*\]\s*$/i;

const knowledgeMode = (testCase: AssistCase) =>
  testCase.kind === 'skeleton' ? ('skeleton' as const) : ('write' as const);

/** Textos do rascunho: um texto, os itens da lista ou os valores de cada item da base. */
function textsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    typeof item === 'string'
      ? [item]
      : Object.values((item as { values: Record<string, string> }).values),
  );
}

/** O que a IA escreveu além do título quando só devia montar o esqueleto (antes de o sistema corrigir). */
function skeletonViolationsIn(
  testCase: AssistCase,
  field: AssistableField,
  output: AssistModelOutput,
): number {
  if (testCase.kind !== 'skeleton' || field.kind !== 'KNOWLEDGE') return 0;
  const beyondTitle = field.subfields.slice(1).map((sub) => sub.id);
  const rows = output.fields.find((entry) => entry.fieldId === field.id)?.rows ?? [];
  return rows.reduce(
    (sum, row) =>
      sum +
      beyondTitle.filter((id) => (row[id] ?? '').trim() !== '' && !ONLY_MARKER.test(row[id]!))
        .length,
    0,
  );
}

export function evaluateAssistCase(
  testCase: AssistCase,
  output: AssistModelOutput,
): AssistEvaluation {
  const field = assistFieldOf(testCase);
  const result = toAssistResult([field], output, { knowledgeMode: knowledgeMode(testCase) })[0]!;
  const texts = textsOf(result.value);
  const sources = [testCase.about, ...testCase.interview.map((entry) => entry.answer)].join('\n');
  return {
    inventedFacts: inventedFactsIn(texts, sources),
    // Campo que a IA não devolveu vira vazio: não é passar do limite.
    overLimit: !result.applicable && texts.some((text) => text.trim() !== ''),
    markers: result.markers,
    skeletonViolations: skeletonViolationsIn(testCase, field, output),
  };
}

export interface AssistCaseReport {
  id: string;
  failed: number;
  inventedFacts: string[];
  overLimit: number;
  markers: number;
  skeletonViolations: number;
  output: string[];
}

export interface AssistReport {
  perCase: AssistCaseReport[];
  inventedFacts: number;
  overLimit: number;
  skeletonViolations: number;
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
    knowledgeMode: knowledgeMode(testCase),
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
      skeletonViolations: 0,
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
      entry.skeletonViolations += evaluation.skeletonViolations;
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
    skeletonViolations: sum((entry) => entry.skeletonViolations),
    failed: sum((entry) => entry.failed),
  };
}

export function formatAssistReport(report: AssistReport): string {
  const rows = [
    ['caso', 'fatos inventados', 'acima do limite', 'marcadores', 'prosa no esqueleto', 'falhas'],
    ...report.perCase.map((entry) => [
      entry.id,
      entry.inventedFacts.length
        ? `${entry.inventedFacts.length} (${entry.inventedFacts.join(', ')})`
        : '0',
      String(entry.overLimit),
      String(entry.markers),
      String(entry.skeletonViolations),
      String(entry.failed),
    ]),
    [
      'total',
      String(report.inventedFacts),
      String(report.overLimit),
      String(report.perCase.reduce((sum, entry) => sum + entry.markers, 0)),
      String(report.skeletonViolations),
      String(report.failed),
    ],
  ];
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  return rows.map((row) => row.map((cell, col) => cell.padEnd(widths[col]!)).join('  ')).join('\n');
}
