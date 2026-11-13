import type { CrmAccessView } from '@gptmaker/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_ACCESS_CHANGED_EVENT } from '@/lib/crm';
import { ApiRequestError } from '@/lib/platform-session';
import { I18nProvider } from '@/i18n';
import { CrmAccessCard } from './crm-access-card';

const api = vi.fn();
const stableApi = (...a: unknown[]) => api(...a);
vi.mock('../../session-provider', () => ({
  useAppSession: () => ({
    session: { canManage: true, features: { crmTools: true } },
    api: stableApi,
  }),
}));
vi.mock('./agent-context', () => ({
  useAgent: () => ({ agent: { id: 'ag1', name: 'Ana', status: 'ACTIVE' } }),
}));

const access = (patch: Partial<CrmAccessView> = {}): CrmAccessView => ({
  available: true,
  status: 'DISABLED',
  lastError: null,
  lastCallAt: null,
  ...patch,
});

const changed = vi.fn();
beforeEach(() => {
  api.mockReset();
  changed.mockReset();
  window.addEventListener(CRM_ACCESS_CHANGED_EVENT, changed);
});
afterEach(() => {
  window.removeEventListener(CRM_ACCESS_CHANGED_EVENT, changed);
  cleanup();
});

const toggle = () => screen.findByRole('switch', { name: 'Acesso ao CRM' });

describe('bloco Acesso ao CRM avisa a agenda', () => {
  it('ligar com sucesso: avisa uma vez, depois de o servidor responder', async () => {
    api.mockResolvedValueOnce(access());
    api.mockResolvedValueOnce(access({ status: 'CONNECTED' }));
    render(<CrmAccessCard />);
    fireEvent.click(await toggle());
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(api.mock.calls.at(-1)![1]).toMatchObject({ method: 'PUT' });
  });

  it('desligar com sucesso: confirma, desliga e avisa', async () => {
    api.mockResolvedValueOnce(access({ status: 'CONNECTED' }));
    api.mockResolvedValueOnce(access({ status: 'DISABLED' }));
    render(<CrmAccessCard />);
    fireEvent.click(await toggle());
    // Só pergunta; nada foi enviado nem avisado ainda.
    const dialog = await screen.findByRole('dialog');
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Desligar' }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  });

  it('falha ao ligar: não avisa (nada mudou para a agenda)', async () => {
    api.mockResolvedValueOnce(access());
    api.mockRejectedValueOnce(new ApiRequestError(409, 'CRM_ACCESS_BUSY', 'ocupado'));
    api.mockResolvedValue(access()); // a releitura depois do erro
    render(<CrmAccessCard />);
    fireEvent.click(await toggle());
    expect(await screen.findByText(/Outra alteração do acesso ao CRM/)).toBeTruthy();
    await act(async () => {});
    expect(changed).not.toHaveBeenCalled();
  });

  it('cancelar o desligamento não avisa', async () => {
    api.mockResolvedValueOnce(access({ status: 'CONNECTED' }));
    render(<CrmAccessCard />);
    fireEvent.click(await toggle());
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    );
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('idioma da interface', () => {
  afterEach(() => window.localStorage.clear());

  it('em inglês, rótulos e erros de API saem traduzidos', async () => {
    window.localStorage.setItem('gptthink.locale', 'en');
    api.mockResolvedValueOnce(access());
    api.mockRejectedValueOnce(new ApiRequestError(409, 'CRM_ACCESS_BUSY', 'ocupado'));
    api.mockResolvedValue(access());
    render(
      <I18nProvider>
        <CrmAccessCard />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole('switch', { name: 'CRM access' }));
    expect(await screen.findByText(/Another change to this agent's CRM access/)).toBeTruthy();
    expect(screen.getByText('Off')).toBeTruthy();
  });
});
