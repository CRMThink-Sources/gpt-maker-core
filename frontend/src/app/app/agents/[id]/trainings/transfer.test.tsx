import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { ApiRequestError } from '@/lib/platform-session';
import AgentTrainingsPage from './page';

const api = vi.fn();
const session = { canManage: true };
vi.mock('../../../session-provider', () => ({
  useAppSession: () => ({ session, api: (...a: unknown[]) => api(...a) }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/app/agents/ag1/trainings',
}));
vi.mock('../agent-context', () => ({
  useAgent: () => ({ agent: { id: 'ag1', name: 'Atendente Comercial', status: 'ACTIVE' } }),
}));

const download = vi.fn();
vi.mock('@/lib/trainings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/trainings')>()),
  downloadJsonFile: (...a: unknown[]) => download(...a),
}));

const EMPTY_LISTING = {
  trainings: [],
  usage: { trainings: { used: 0, limit: null } },
  page: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  availableTags: [],
};
const exported = (trainings: unknown[]) => ({
  version: 1,
  exportedAt: '2026-11-16T12:00:00.000Z',
  trainings,
});

function mockApi(overrides: Record<string, unknown | (() => unknown)> = {}) {
  api.mockImplementation((path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path}`;
    if (key in overrides) {
      const value = overrides[key];
      return Promise.resolve(typeof value === 'function' ? value() : value);
    }
    if (path.endsWith('/function')) return Promise.resolve({ mode: 'SIMPLE' });
    return Promise.resolve(EMPTY_LISTING);
  });
}

function renderPage() {
  return render(
    <I18nProvider>
      <AgentTrainingsPage />
    </I18nProvider>,
  );
}

const fileOf = (content: string) =>
  new File([content], 'treinamentos.json', { type: 'application/json' });

beforeEach(() => {
  api.mockReset();
  download.mockReset();
  session.canManage = true;
});
afterEach(cleanup);

describe('exportar treinamentos', () => {
  it('baixa o arquivo com o nome do agente', async () => {
    const file = exported([{ type: 'TEXT', text: 'Preços' }]);
    mockApi({ 'GET /app/agents/ag1/trainings/export': file });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Exportar' }));

    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(download.mock.calls[0]?.[0]).toEqual(file);
    expect(download.mock.calls[0]?.[1]).toMatch(
      /^treinamentos-atendente-comercial-\d{4}-\d{2}-\d{2}\.json$/,
    );
    expect(screen.queryByText(/guarda o link das imagens/)).toBeNull();
  });

  it('avisa que o arquivo guarda o link das imagens', async () => {
    mockApi({
      'GET /app/agents/ag1/trainings/export': exported([
        {
          type: 'TEXT',
          text: 'Preços',
          imageUrl: 'https://api.exemplo.com/public/training-images/x',
        },
      ]),
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Exportar' }));

    expect(await screen.findByText(/guarda o link das imagens/)).toBeTruthy();
    expect(download).toHaveBeenCalled();
  });

  it('sem treinamentos manuais não baixa nada e avisa', async () => {
    mockApi({ 'GET /app/agents/ag1/trainings/export': exported([]) });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Exportar' }));

    expect(await screen.findByText('Não há treinamentos manuais para exportar.')).toBeTruthy();
    expect(download).not.toHaveBeenCalled();
  });

  it('perfil somente consulta exporta, mas não vê Importar', async () => {
    session.canManage = false;
    mockApi();
    renderPage();

    expect(await screen.findByRole('button', { name: 'Exportar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Importar' })).toBeNull();
  });
});

describe('importar treinamentos', () => {
  async function openModal() {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Importar' }));
    return screen.findByLabelText(/Arquivo de treinamentos/);
  }

  it('arquivo que não é JSON mostra o erro e não chama a API', async () => {
    mockApi();
    const input = await openModal();

    fireEvent.change(input, { target: { files: [fileOf('isto não é json')] } });

    expect(
      await screen.findByText('O arquivo não é uma exportação de treinamentos válida.'),
    ).toBeTruthy();
    // O último "Importar" é o do rodapé do modal (o primeiro é o da página).
    const submit = screen.getAllByRole('button', { name: 'Importar' }).at(-1) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(api.mock.calls.some(([path]) => String(path).endsWith('/import'))).toBe(false);
  });

  it('mostra a contagem e avisa que soma aos existentes e sobre imagens', async () => {
    mockApi();
    const input = await openModal();

    fireEvent.change(input, {
      target: {
        files: [
          fileOf(
            JSON.stringify(
              exported([
                {
                  type: 'TEXT',
                  text: 'a',
                  imageUrl: 'https://api.exemplo.com/public/training-images/x',
                },
                { type: 'VIDEO', url: 'https://youtu.be/x' },
              ]),
            ),
          ),
        ],
      },
    });

    expect(await screen.findByText('Itens no arquivo: 2')).toBeTruthy();
    expect(screen.getByText(/1 texto\(s\) com imagem/)).toBeTruthy();
    expect(
      screen.getByText(/Importar o mesmo arquivo de novo cria os treinamentos de novo/),
    ).toBeTruthy();
  });

  it('envia o arquivo, mostra o resultado misto e recarrega a lista', async () => {
    const result = {
      summary: { created: 1, rejected: 1, failed: 0, withWarnings: 1 },
      items: [
        {
          position: 1,
          type: 'TEXT',
          status: 'CREATED',
          trainingId: 't1',
          reason: null,
          warnings: [{ code: 'IMAGE_NOT_FOUND', message: 'x' }],
        },
        {
          position: 2,
          type: 'WEBSITE',
          status: 'REJECTED',
          trainingId: null,
          reason: { code: 'PLAN_TRAINING_LIMIT', message: 'x' },
          warnings: [],
        },
      ],
    };
    mockApi({ 'POST /app/agents/ag1/trainings/import': result });
    const input = await openModal();
    const listCalls = () =>
      api.mock.calls.filter(([path]) => path === '/app/agents/ag1/trainings').length;
    const before = listCalls();

    fireEvent.change(input, {
      target: {
        files: [
          fileOf(
            JSON.stringify(
              exported([
                { type: 'TEXT', text: 'a' },
                { type: 'WEBSITE', url: 'https://a.com' },
              ]),
            ),
          ),
        ],
      },
    });
    await screen.findByText('Itens no arquivo: 2');
    fireEvent.click(screen.getAllByRole('button', { name: 'Importar' }).at(-1)!);

    expect(await screen.findByText('Criados: 1 · Não criados: 1')).toBeTruthy();
    expect(screen.getByText(/Limite de treinamentos do plano atingido/)).toBeTruthy();
    expect(screen.getByText(/Imagem não importada: ela não existe mais/)).toBeTruthy();
    const post = api.mock.calls.find(([path]) => String(path).endsWith('/import'));
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toMatchObject({ version: 1 });
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
  });

  it('erro da API no arquivo inteiro aparece traduzido', async () => {
    api.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.reject(new ApiRequestError(409, 'TRAINING_IMPORT_BUSY', 'x'));
      }
      return Promise.resolve(path.endsWith('/function') ? { mode: 'SIMPLE' } : EMPTY_LISTING);
    });
    const input = await openModal();
    fireEvent.change(input, {
      target: { files: [fileOf(JSON.stringify(exported([{ type: 'TEXT', text: 'a' }])))] },
    });
    await screen.findByText('Itens no arquivo: 1');

    fireEvent.click(screen.getAllByRole('button', { name: 'Importar' }).at(-1)!);

    expect(
      await screen.findByText('Outra importação está em andamento; tente de novo em instantes.'),
    ).toBeTruthy();
  });
});
