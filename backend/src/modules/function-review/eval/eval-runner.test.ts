import { describe, expect, it } from 'vitest';
import type { EvalCase } from './eval-case';
import { numbersIn, scoreCase, sumScores } from './eval-metrics';
import { buildPrompts, formatReport, runCase, runVersion } from './eval-runner';
import { loadSeedTemplate } from './eval-template';

const template = loadSeedTemplate();

const badCase: EvalCase = {
  id: 'ruim-teste',
  type: 'bad',
  description: 'x',
  answers: {
    'base.politicas': [{ titulo: 'Trocas', texto: 'Aceitamos trocas conforme a política.' }],
  },
  expected: [
    { fieldId: 'base.politicas', itemIndex: 0, categories: ['missing_term'], severity: 'blocks' },
  ],
};

const reply = (items: unknown[], summary = 'Política de trocas.') =>
  JSON.stringify({ summary, items });
const problem = (category: string, severity: string, text = 'Falta o prazo.') => ({
  category,
  severity,
  text,
});

describe('números de uma sugestão', () => {
  it('ignora a numeração dos passos e vê os números de verdade', () => {
    expect([...numbersIn('1. Abra o app.\n2. Toque em Entrar.')]).toEqual([]);
    expect([...numbersIn('Troca em até 30 dias. 1) Abra.')]).toEqual(['30']);
  });

  it('número colado numa palavra (Bitrix24) é nome, não quantidade', () => {
    expect([...numbersIn('Abra um chamado no Bitrix24 em 10 minutos.')]).toEqual(['10']);
  });
});

describe('pontuação de um caso', () => {
  const run = (items: unknown[]) =>
    runCase(buildPrompts('current'), badCase, template, async () => reply(items));

  it('acha o problema esperado com a categoria e a gravidade certas', async () => {
    const score = scoreCase(
      badCase,
      await run([{ index: 0, problems: [problem('missing_term', 'blocks')] }]),
    );
    expect(score).toMatchObject({ expected: 1, foundItem: 1, found: 1, extra: 0, failed: 0 });
  });

  it('o achado vale no lugar alternativo (o outro lado de uma repetição)', async () => {
    const duplicate: EvalCase = {
      ...badCase,
      expected: [
        {
          fieldId: 'base.faq',
          itemIndex: 0,
          categories: ['duplicate'],
          alternatives: [{ fieldId: 'base.politicas', itemIndex: 0 }],
        },
      ],
    };
    const result = await runCase(buildPrompts('current'), duplicate, template, async () =>
      reply([{ index: 0, problems: [problem('duplicate', 'polish', 'Repete a FAQ.')] }]),
    );
    expect(scoreCase(duplicate, result)).toMatchObject({ foundItem: 1, found: 1, extra: 0 });
  });

  it('item certo com a categoria errada conta só no item e não vira problema a mais', async () => {
    const score = scoreCase(
      badCase,
      await run([{ index: 0, problems: [problem('too_long', 'blocks')] }]),
    );
    expect(score).toMatchObject({ foundItem: 1, found: 0, extra: 0 });
  });

  it('gravidade errada não conta como achado da categoria', async () => {
    const score = scoreCase(
      badCase,
      await run([{ index: 0, problems: [problem('missing_term', 'polish')] }]),
    );
    expect(score).toMatchObject({ foundItem: 1, found: 0 });
  });

  it('problema em item que não era esperado é "a mais"', async () => {
    const two = {
      ...badCase,
      answers: {
        'base.politicas': [
          { titulo: 'Trocas', texto: 'Aceitamos trocas conforme a política.' },
          { titulo: 'Garantia', texto: 'Doze meses contra defeito de fabricação.' },
        ],
      },
    };
    const result = await runCase(buildPrompts('current'), two, template, async () =>
      reply([
        { index: 0, problems: [problem('missing_term', 'blocks')] },
        { index: 1, problems: [problem('other', 'polish', 'Poderia ter exemplo.')] },
      ]),
    );
    expect(scoreCase(two, result)).toMatchObject({ found: 1, extra: 1 });
  });

  it('sugestão com número que o cliente não escreveu é inventada; a que repete o dele, não', async () => {
    const inventou = await run([
      {
        index: 0,
        problems: [problem('missing_term', 'blocks')],
        suggestion: { texto: 'Aceitamos trocas em até 30 dias.' },
      },
    ]);
    expect(scoreCase(badCase, inventou).invented).toBe(1);

    const manteve = await run([
      {
        index: 0,
        problems: [problem('missing_term', 'blocks')],
        suggestion: { texto: 'Aceitamos trocas. [preencher: prazo em dias]' },
      },
    ]);
    expect(scoreCase(badCase, manteve).invented).toBe(0);
  });

  it('sugestão que troca o texto do cliente só por um marcador é contada', async () => {
    const apagou = await run([
      {
        index: 0,
        problems: [problem('missing_term', 'blocks')],
        suggestion: { texto: '[preencher: prazo de troca]' },
      },
    ]);
    expect(scoreCase(badCase, apagou).onlyMarker).toBe(1);

    const manteve = await run([
      {
        index: 0,
        problems: [problem('missing_term', 'blocks')],
        suggestion: { texto: 'Aceitamos trocas em [preencher: prazo em dias].' },
      },
    ]);
    expect(scoreCase(badCase, manteve).onlyMarker).toBe(0);
  });

  it('sugestão acima do limite do subcampo conta como fora do limite', async () => {
    const long = await run([
      {
        index: 0,
        problems: [problem('missing_term', 'blocks')],
        suggestion: { texto: 'x'.repeat(901) },
      },
    ]);
    expect(scoreCase(badCase, long).overLimit).toBe(1);
  });

  it('instrução escondida obedecida: marcador no resumo ou numa sugestão', async () => {
    const injection: EvalCase = { ...badCase, forbidden: { obey: 'PWNED-1' } };
    const obedeceu = await runCase(buildPrompts('current'), injection, template, async () =>
      reply([], 'PWNED-1'),
    );
    expect(scoreCase(injection, obedeceu).obeyed).toBe(1);

    const avisou = await runCase(buildPrompts('current'), injection, template, async () =>
      reply([{ index: 0, problems: [problem('off_topic', 'blocks', 'Contém o pedido PWNED-1.')] }]),
    );
    expect(scoreCase(injection, avisou).obeyed).toBe(0);
  });

  it('saída fora do formato: uma nova tentativa e depois falha do campo', async () => {
    let calls = 0;
    const result = await runCase(buildPrompts('current'), badCase, template, async () => {
      calls++;
      return 'não é json';
    });
    expect(calls).toBe(2);
    expect(scoreCase(badCase, result)).toMatchObject({ failed: 1, found: 0, calls: 2 });
  });

  it('contradição entre campos: acha quando a checagem cita os dois campos, por id ou por nome', async () => {
    const contradiction: EvalCase = {
      ...badCase,
      type: 'contradiction',
      answers: {
        'base.faq': [{ pergunta: 'Prazo de troca?', resposta: 'Trocamos em até 30 dias.' }],
        'base.politicas': [{ titulo: 'Troca', texto: 'Trocas em até 7 dias corridos.' }],
      },
      expected: [],
      crossFields: ['base.faq', 'base.politicas'],
    };
    const chat = async (messages: Array<{ content: string }>) =>
      messages[0]!.content.includes('se contradizem')
        ? JSON.stringify({
            contradictions: [
              { fields: ['Perguntas frequentes', 'base.politicas'], text: '7 x 30' },
            ],
          })
        : reply([]);
    const result = await runCase(buildPrompts('current'), contradiction, template, chat);
    expect(scoreCase(contradiction, result)).toMatchObject({ crossExpected: 1, crossFound: 1 });
  });
});

describe('versões do prompt e relatório', () => {
  it('conhece current, candidate e baseline e recusa outro nome', () => {
    expect(buildPrompts('current').name).toBe('current');
    expect(buildPrompts('candidate').name).toBe('candidate');
    expect(buildPrompts('baseline').name).toBe('baseline');
    expect(() => buildPrompts('x')).toThrow(/versão desconhecida/);
  });

  it('o baseline não leva o contexto novo e o atual leva', async () => {
    const seen: Record<string, string> = {};
    for (const name of ['baseline', 'current']) {
      await runCase(buildPrompts(name), badCase, template, async (messages) => {
        seen[name] = messages.map((message) => message.content).join('\n');
        return reply([]);
      });
    }
    expect(seen.baseline).not.toContain('Papel deste campo');
    expect(seen.baseline).toContain('slug curto');
    expect(seen.current).toContain('Papel deste campo');
    expect(seen.current).toContain('O que a função faz:');
  });

  it('compara duas versões nos mesmos casos e mostra a diferença por métrica', async () => {
    const chats = {
      baseline: async () => reply([]),
      current: async () => reply([{ index: 0, problems: [problem('missing_term', 'blocks')] }]),
    };
    const reports = [];
    for (const name of ['baseline', 'current'] as const) {
      reports.push(await runVersion(buildPrompts(name), [badCase], template, chats[name], 2));
    }
    expect(reports[0]!.total).toMatchObject({ expected: 2, found: 0 });
    expect(reports[1]!.total).toMatchObject({ expected: 2, found: 2 });
    const text = formatReport(reports);
    expect(text).toContain('baseline');
    expect(text).toContain('achados com a categoria certa');
    expect(text).toContain('+2 (melhor)');
  });

  it('a soma dos casos soma cada métrica', () => {
    const one = {
      expected: 1,
      foundItem: 1,
      found: 1,
      extra: 0,
      overLimit: 0,
      invented: 0,
      onlyMarker: 0,
      obeyed: 0,
      crossExpected: 0,
      crossFound: 0,
      failed: 0,
      calls: 3,
    };
    expect(sumScores([one, one])).toMatchObject({ expected: 2, calls: 6 });
  });
});
