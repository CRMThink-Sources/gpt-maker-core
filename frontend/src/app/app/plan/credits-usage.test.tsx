import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { UsageSection } from './credits-sections';

const api = vi.fn();
vi.mock('../session-provider', () => ({
  useAppSession: () => ({ api: (...args: unknown[]) => api(...args) }),
}));

const usage = {
  rows: [
    {
      day: '2026-11-16',
      agentId: 'a1',
      agentName: 'Ana',
      kind: 'RESPONSE',
      responses: 12,
      credits: 12,
    },
    {
      day: '2026-11-16',
      agentId: 'a1',
      agentName: 'Ana',
      kind: 'FUNCTION_REVIEW',
      responses: 3,
      credits: 6,
    },
    {
      day: '2026-11-16',
      agentId: 'a1',
      agentName: 'Ana',
      kind: 'HALLUCINATION_ANALYSIS',
      responses: 2,
      credits: 6,
    },
    {
      day: '2026-11-15',
      agentId: 'a2',
      agentName: 'Beto',
      kind: 'HALLUCINATION_ANALYSIS',
      responses: 1,
      credits: 3,
    },
  ],
  totals: { responses: 12, credits: 27 },
};

beforeEach(() => {
  api.mockReset();
  api.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith('/app/agents') ? { agents: [] } : usage),
  );
});
afterEach(cleanup);

describe('extrato de consumo: análise de alucinação', () => {
  it('rotula a linha e conta análises (no singular e no plural), sem misturar com respostas', async () => {
    render(
      <I18nProvider>
        <UsageSection cycleStart={null} />
      </I18nProvider>,
    );

    const rows = await screen.findAllByText('Análise de alucinação');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('2 análises')).toBeTruthy();
    expect(screen.getByText('1 análise')).toBeTruthy();
    // A linha de revisão continua com o próprio rótulo e a contagem de campos.
    expect(screen.getByText('Revisão da função')).toBeTruthy();
    expect(screen.getByText('3 campos')).toBeTruthy();

    // O rótulo da análise fica na linha do agente certo.
    const beto = screen.getByText('Beto').closest('tr')!;
    expect(within(beto).getByText('Análise de alucinação')).toBeTruthy();
    expect(within(beto).getByText('1 análise')).toBeTruthy();
  });
});
