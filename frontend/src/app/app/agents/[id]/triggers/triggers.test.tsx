import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { LOCALE_STORAGE_KEY } from '@/i18n/config';
import AgentTriggersPage from './page';
import { TriggerEditor } from './trigger-editor';

const api = vi.fn();
const stableApi = (...a: unknown[]) => api(...a);
vi.mock('../../../session-provider', () => ({
  useAppSession: () => ({ session: { canManage: true }, api: stableApi }),
}));
vi.mock('../agent-context', () => ({
  useAgent: () => ({ agent: { id: 'ag1', name: 'Ana', status: 'ACTIVE' } }),
}));

const trigger = {
  id: 't1',
  name: 'Lead ao fim',
  event: 'onFinishInteraction',
  active: true,
  actions: [{ id: 'a1', type: 'CREATE_LEAD', config: { fields: { TITLE: 'x' } } }],
};

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({ triggers: [trigger] });
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('aba Gatilhos', () => {
  it('lista o gatilho em pt-BR por padrão', async () => {
    render(<AgentTriggersPage />);
    expect(await screen.findByText('Lead ao fim')).toBeTruthy();
    expect(screen.getByText('Fim de atendimento → Criar lead')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Novo gatilho' })).toBeTruthy();
  });

  it('lista o gatilho em inglês quando o idioma é en', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    render(
      <I18nProvider>
        <AgentTriggersPage />
      </I18nProvider>,
    );
    expect(await screen.findByText('Conversation end → Create lead')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New trigger' })).toBeTruthy();
  });

  it('mostra o erro de API traduzido pelo código', async () => {
    const { ApiRequestError } = await import('@/lib/platform-session');
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    api.mockRejectedValue(new ApiRequestError(409, 'AGENT_OUT_OF_SYNC', 'O agente não foi'));
    render(
      <I18nProvider>
        <AgentTriggersPage />
      </I18nProvider>,
    );
    expect(await screen.findByText(/No se encontró el agente en GPTMaker/)).toBeTruthy();
  });
});

describe('editor de gatilho', () => {
  it('abre com os textos iniciais no idioma da tela', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    render(
      <I18nProvider>
        <TriggerEditor agentId="ag1" trigger={null} onClose={() => undefined} onSaved={vi.fn()} />
      </I18nProvider>,
    );
    expect(await screen.findByText('New trigger')).toBeTruthy();
    expect(screen.getByLabelText('Add action')).toBeTruthy();
    expect(screen.getByLabelText('Move up')).toBeTruthy();
  });
});
