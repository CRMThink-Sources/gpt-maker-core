import type { ReviewProblem } from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { impactMessage, reviewImpact, sortedProblems, visibleProblems } from './review-logic';

const problem = (
  text: string,
  severity: ReviewProblem['severity'],
  category: ReviewProblem['category'] = 'other',
): ReviewProblem => ({ code: category, category, severity, text });

describe('problemas por gravidade', () => {
  it('lista os que atrapalham antes dos de melhoria, mantendo a ordem dentro de cada grupo', () => {
    const sorted = sortedProblems([
      problem('a', 'polish'),
      problem('b', 'blocks'),
      problem('c', 'polish'),
      problem('d', 'blocks'),
    ]);
    expect(sorted.map((entry) => entry.text)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('até 3 problemas aparecem todos', () => {
    const { shown, hidden } = visibleProblems([
      problem('a', 'polish'),
      problem('b', 'polish'),
      problem('c', 'blocks'),
    ]);
    expect(shown.map((entry) => entry.text)).toEqual(['c', 'a', 'b']);
    expect(hidden).toEqual([]);
  });

  it('com mais de 3, só os que atrapalham ficam à vista e as melhorias recolhem', () => {
    const { shown, hidden } = visibleProblems([
      ...Array.from({ length: 5 }, (_, i) => problem(`p${i}`, 'polish')),
      problem('grave', 'blocks'),
    ]);
    expect(shown.map((entry) => entry.text)).toEqual(['grave']);
    expect(hidden).toHaveLength(5);
  });

  it('sem nenhum item, nada a mostrar', () => {
    expect(visibleProblems([])).toEqual({ shown: [], hidden: [] });
  });
});

describe('resumo do que atrapalha o agente', () => {
  const item = (...severities: ReviewProblem['severity'][]) => ({
    index: 0,
    problems: severities.map((severity, i) => problem(`p${i}`, severity)),
  });

  it('conta itens que atrapalham à parte dos que só têm melhorias, em vários campos', () => {
    const impact = reviewImpact([
      { items: [item('blocks'), item('polish', 'blocks'), item('polish')] },
      { items: [item('polish'), item(), item('polish', 'polish')] },
    ]);
    expect(impact).toEqual({ blocking: 2, polishOnly: 3 });
    expect(impactMessage(impact)).toBe('2 itens atrapalham o agente e 3 têm melhorias');
  });

  it('singular, só um dos grupos e nada a dizer', () => {
    expect(impactMessage({ blocking: 1, polishOnly: 0 })).toBe('1 item atrapalha o agente');
    expect(impactMessage({ blocking: 0, polishOnly: 1 })).toBe('1 tem melhorias');
    expect(impactMessage({ blocking: 0, polishOnly: 0 })).toBeNull();
  });
});
