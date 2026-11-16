import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locale } from '@gptmaker/contracts';
import { LANDING_TAB_IDS } from '@/lib/landing';
import { buildTutorialTabs } from './tutorial-tabs';

afterEach(cleanup);

const LOCALES: Locale[] = ['pt-BR', 'en', 'es'];

describe('buildTutorialTabs', () => {
  it.each(LOCALES)('monta as 6 abas com 3 passos cada (%s)', (locale) => {
    const tabs = buildTutorialTabs(locale);
    expect(tabs.map((t) => t.id)).toEqual([...LANDING_TAB_IDS]);
    for (const tab of tabs) {
      expect(tab.steps).toHaveLength(3);
      expect(tab.steps.map((s) => s.counter)).toEqual(
        [1, 2, 3].map((n) => expect.stringContaining(String(n))),
      );
    }
  });

  // Cada tela simulada precisa de exatamente um destaque, com o nome do alvo do passo, e não pode
  // mostrar chave de tradução sem texto (`landing.<chave>`).
  it.each(LOCALES)('toda tela tem um destaque nomeado e nenhum texto faltando (%s)', (locale) => {
    for (const tab of buildTutorialTabs(locale)) {
      tab.steps.forEach((step, i) => {
        const { container, unmount } = render(<>{step.screen}</>);
        const hotspots = container.querySelectorAll('button[data-tutorial-hotspot]');
        expect(hotspots, `${tab.id} passo ${i + 1}`).toHaveLength(1);
        expect(hotspots[0]?.getAttribute('aria-label'), `${tab.id} passo ${i + 1}`).toBe(
          step.target,
        );
        expect(container.textContent, `${tab.id} passo ${i + 1}`).not.toContain('landing.');
        expect(step.title && step.text && step.target).toBeTruthy();
        unmount();
      });
    }
  });
});
