import { functionTemplateContentSchema } from '@gptmaker/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createT, I18nProvider } from '@/i18n';
import { LOCALE_STORAGE_KEY } from '@/i18n/config';
import { FunctionForm } from './function-form';
import { impactMessage, reviewCost } from './review-logic';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const form = functionTemplateContentSchema.parse({
  agentType: 'SUPPORT',
  profile: { jobName: 'Suporte' },
  behavior: 'Você é {{agente.nome}}. {{empresa.sobre}}',
  assist: { enabled: true },
  fields: [
    {
      kind: 'TEXT',
      id: 'empresa.sobre',
      label: 'Sobre a empresa',
      required: false,
      maxLength: 300,
      assist: { questions: ['O que a empresa vende?'] },
    },
  ],
});

const assist = {
  api: vi.fn() as never,
  endpoint: '/x',
  aiKey: null,
};

describe('formulário da função em outros idiomas', () => {
  it.each([
    ['en', 'AI help', 'How the agent responds', '(optional)'],
    ['es', 'Ayuda de la IA', 'Cómo atiende el agente', '(opcional)'],
  ])('mostra os textos em %s', (locale, button, title, optional) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    render(
      <I18nProvider>
        <FunctionForm form={form} answers={{}} onChange={() => undefined} assist={assist} />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: button })).toBeTruthy();
    expect(screen.getByText(optional)).toBeTruthy();
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
  });

  it('custo e resumo da revisão seguem o idioma', () => {
    const en = createT('en', 'assist');
    const es = createT('es', 'assist');
    expect(reviewCost(1, 1, false, en).label).toBe('1 credit');
    expect(reviewCost(5, 3, false, es).label).toBe('15 créditos');
    expect(reviewCost(5, 3, true, en).label).toBe('no credits used');
    expect(impactMessage({ blocking: 2, polishOnly: 1 }, en)).toBe(
      '2 items hinder the agent and 1 has improvements',
    );
  });
});
