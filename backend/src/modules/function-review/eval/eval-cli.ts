import { formatAssistReport, loadAssistCases, runAssistEval } from './assist-eval';
import { type EvalCase, loadCases } from './eval-case';
import { buildPrompts, type Chat, formatReport, runVersion } from './eval-runner';
import { loadSeedTemplate } from './eval-template';

export interface CliIo {
  /** Chave do Vibecode só para a avaliação; nunca a de um cliente. */
  apiKey: string | undefined;
  /** Monta o `Chat` com a chave; só é chamado depois de a chave e os argumentos passarem. */
  makeChat: (apiKey: string) => Chat;
  write: (line: string) => void;
}

export interface CliOptions {
  versions: string[];
  repeat: number;
  caseIds: string[] | null;
  /** Mostra, dos casos com algo a olhar, o que a IA devolveu. */
  details: boolean;
  /** Avalia a ajuda da IA para preencher campos, em vez da revisão. */
  assist: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const flag = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const repeat = Number(flag('repeat') ?? 2);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) {
    throw new Error('--repeat deve ser um inteiro de 1 a 5');
  }
  return {
    versions: (flag('versions') ?? 'current').split(',').filter(Boolean),
    repeat,
    caseIds: flag('cases')?.split(',').filter(Boolean) ?? null,
    details: argv.includes('--details'),
    assist: argv.includes('--assist'),
  };
}

/**
 * Avaliação da revisão por IA (spec agent-review-evaluation). Roda os casos com as versões pedidas
 * e imprime a tabela; com duas versões, mostra a diferença. Não usa banco, Redis nem créditos: chama
 * o Vibecode direto, com a chave `VIBECODE_EVAL_API_KEY`. Devolve o código de saída.
 */
export async function main(argv: string[], io: CliIo): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
    for (const name of options.versions) buildPrompts(name);
    if (options.versions.length > 2) throw new Error('compare no máximo duas versões por vez');
  } catch (error) {
    io.write(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (!io.apiKey) {
    io.write('Falta a chave do Vibecode: defina VIBECODE_EVAL_API_KEY. Nenhuma chamada foi feita.');
    return 1;
  }

  if (options.assist) return runAssist(options, io);

  const all = loadCases();
  const cases: EvalCase[] = options.caseIds
    ? all.filter((entry) => options.caseIds!.includes(entry.id))
    : all;
  if (cases.length === 0) {
    io.write('Nenhum caso encontrado para os ids pedidos.');
    return 1;
  }

  const chat = io.makeChat(io.apiKey);
  const template = loadSeedTemplate();
  const reports = [];
  for (const name of options.versions) {
    io.write(`Rodando ${cases.length} casos x ${options.repeat} com a versão ${name}…`);
    reports.push(await runVersion(buildPrompts(name), cases, template, chat, options.repeat));
  }
  io.write('');
  io.write(formatReport(reports));
  for (const report of reports) {
    const weak = report.perCase.filter(
      (entry) =>
        entry.score.failed > 0 ||
        entry.score.found < entry.score.expected ||
        entry.score.extra > 0 ||
        entry.score.obeyed > 0 ||
        entry.score.invented > 0,
    );
    if (weak.length) {
      io.write('');
      io.write(
        `${report.version}: casos com algo a olhar: ${weak.map((entry) => entry.id).join(', ')}`,
      );
      if (options.details) {
        for (const entry of weak) {
          io.write('');
          io.write(`[${report.version}] ${entry.details.join('\n--- repetição ---\n')}`);
        }
      }
    }
  }
  return 0;
}

/** Avaliação da ajuda da IA: zero fatos inventados e nenhum texto acima do limite é o esperado. */
async function runAssist(options: CliOptions, io: CliIo): Promise<number> {
  const all = loadAssistCases();
  const cases = options.caseIds ? all.filter((entry) => options.caseIds!.includes(entry.id)) : all;
  if (cases.length === 0) {
    io.write('Nenhum caso encontrado para os ids pedidos.');
    return 1;
  }
  io.write(`Rodando ${cases.length} casos da ajuda da IA x ${options.repeat}…`);
  const report = await runAssistEval(cases, io.makeChat(io.apiKey!), options.repeat);
  io.write('');
  io.write(formatAssistReport(report));
  if (options.details) {
    for (const entry of report.perCase.filter(
      (item) => item.inventedFacts.length || item.overLimit,
    )) {
      io.write('');
      io.write(`[${entry.id}] ${entry.output.join('\n--- repetição ---\n')}`);
    }
  }
  return 0;
}
