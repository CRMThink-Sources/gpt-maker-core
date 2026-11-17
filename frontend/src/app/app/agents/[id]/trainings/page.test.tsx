import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import AgentTrainingsPage from './page';

const api = vi.fn();
let params = new URLSearchParams();
const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace }),
  usePathname: () => '/app/agents/ag1/trainings',
}));
vi.mock('../../../session-provider', () => ({
  useAppSession: () => ({ session: { canManage: true }, api: (...a: unknown[]) => api(...a) }),
}));
vi.mock('../agent-context', () => ({
  useAgent: () => ({ agent: { id: 'ag1', status: 'ACTIVE' } }),
}));

const training = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `t${i}`,
  type: 'TEXT',
  status: 'DONE',
  managed: false,
  text: `Treinamento número ${i}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  image: null,
  document: null,
  tags: [],
  expiresAt: null,
  expiredAt: null,
  ...extra,
});

function listing(
  trainings: unknown[],
  page: Partial<{ page: number; total: number; totalPages: number }> = {},
  availableTags: string[] = [],
) {
  return {
    trainings,
    usage: { trainings: { used: trainings.length, limit: null } },
    page: {
      page: 1,
      pageSize: 20,
      total: trainings.length,
      totalPages: 1,
      ...page,
    },
    availableTags,
  };
}

function mockApi(result: unknown) {
  api.mockImplementation((path: string) =>
    Promise.resolve(path.endsWith('/function') ? { mode: 'SIMPLE' } : result),
  );
}

const listCalls = () =>
  api.mock.calls.map((call) => call[0] as string).filter((path) => !path.endsWith('/function'));

beforeEach(() => {
  api.mockReset();
  replace.mockReset();
  params = new URLSearchParams();
});
afterEach(cleanup);

describe('lista de treinamentos paginada', () => {
  it('mostra a página recebida, o total e a navegação', async () => {
    mockApi(listing([training(1), training(2)], { total: 45, totalPages: 3 }));
    render(<AgentTrainingsPage />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(screen.getByText('45 treinamentos')).toBeTruthy();
    expect(screen.getByText('Página 1 de 3')).toBeTruthy();
    expect((screen.getByText('Anterior') as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Próxima" vai para a página 2 na URL', async () => {
    mockApi(listing([training(1)], { total: 45, totalPages: 3 }));
    render(<AgentTrainingsPage />);
    fireEvent.click(await screen.findByText('Próxima'));
    expect(replace).toHaveBeenCalledWith('/app/agents/ag1/trainings?page=2', { scroll: false });
  });

  it('lista de uma página só não mostra os botões de navegação', async () => {
    mockApi(listing([training(1), training(2)]));
    render(<AgentTrainingsPage />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(screen.queryByText('Próxima')).toBeNull();
  });

  it('pede à API a página e os filtros que estão na URL (recarregar mantém o contexto)', async () => {
    params = new URLSearchParams('page=2&q=preços&tags=promo');
    mockApi(listing([training(1)], { page: 2, total: 25, totalPages: 2 }));
    render(<AgentTrainingsPage />);
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    expect(listCalls()[0]).toBe('/app/agents/ag1/trainings?page=2&q=pre%C3%A7os&tags=promo');
    expect((screen.getByLabelText('Buscar treinamento') as HTMLInputElement).value).toBe('preços');
  });
});

describe('filtros', () => {
  it('escolher uma tag volta à página 1', async () => {
    params = new URLSearchParams('page=3');
    mockApi(listing([training(1)], { page: 3, total: 50, totalPages: 3 }, ['promo', 'frete']));
    render(<AgentTrainingsPage />);
    const group = await screen.findByRole('group', { name: 'Tags' });
    fireEvent.click(within(group).getByText('promo'));
    expect(replace).toHaveBeenCalledWith('/app/agents/ag1/trainings?tags=promo', {
      scroll: false,
    });
  });

  it('filtrar por estado expirado vai para a URL', async () => {
    mockApi(listing([training(1)], { total: 30, totalPages: 2 }));
    render(<AgentTrainingsPage />);
    fireEvent.change(await screen.findByLabelText('Estado'), { target: { value: 'EXPIRED' } });
    expect(replace).toHaveBeenCalledWith('/app/agents/ag1/trainings?status=EXPIRED', {
      scroll: false,
    });
  });

  it('a busca vai à URL só depois da pausa na digitação', async () => {
    mockApi(listing([training(1)], { total: 30, totalPages: 2 }));
    render(<AgentTrainingsPage />);
    fireEvent.change(await screen.findByLabelText('Buscar treinamento'), {
      target: { value: 'garantia' },
    });
    expect(replace).not.toHaveBeenCalled();
    await waitFor(
      () =>
        expect(replace).toHaveBeenCalledWith('/app/agents/ag1/trainings?q=garantia', {
          scroll: false,
        }),
      { timeout: 2000 },
    );
  });

  it('sem resultado para os filtros, avisa e oferece limpar', async () => {
    params = new URLSearchParams('q=zzz');
    mockApi(listing([], { total: 0, totalPages: 0 }));
    render(<AgentTrainingsPage />);
    expect(await screen.findByText('Nenhum treinamento atende aos filtros.')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Limpar filtros')[0]!);
    expect(replace).toHaveBeenCalledWith('/app/agents/ag1/trainings', { scroll: false });
  });

  it('agente sem treinamentos e sem filtro mostra o estado vazio, sem barra de filtros', async () => {
    mockApi(listing([], { total: 0, totalPages: 0 }));
    render(<AgentTrainingsPage />);
    expect(await screen.findByText('Nenhum treinamento ainda')).toBeTruthy();
    expect(screen.queryByLabelText('Buscar treinamento')).toBeNull();
  });
});

describe('tags e expiração nos itens', () => {
  it('mostra as tags e a data de expiração futura', async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    mockApi(listing([training(1, { tags: ['preços', 'promo'], expiresAt: soon })]));
    render(<AgentTrainingsPage />);
    const item = (await screen.findAllByRole('listitem'))[0]!;
    expect(within(item).getByText('preços')).toBeTruthy();
    expect(within(item).getByText('promo')).toBeTruthy();
    expect(within(item).getByText(/expira em/)).toBeTruthy();
    expect(within(item).getByText('Tags e prazo')).toBeTruthy();
  });

  it('expirado mostra o selo e só oferece remover', async () => {
    mockApi(
      listing([
        training(1, {
          status: 'EXPIRED',
          expiredAt: '2026-11-01T10:00:00.000Z',
          expiresAt: '2026-11-01T09:00:00.000Z',
        }),
      ]),
    );
    render(<AgentTrainingsPage />);
    const item = (await screen.findAllByRole('listitem'))[0]!;
    expect(within(item).getByText('Expirado')).toBeTruthy();
    expect(within(item).getByText(/expirou em/)).toBeTruthy();
    expect(within(item).queryByText('Editar')).toBeNull();
    expect(within(item).queryByText('Tags e prazo')).toBeNull();
    expect(within(item).queryByText('Reenviar')).toBeNull();
    expect(within(item).getByText('Remover')).toBeTruthy();
  });
});

describe('interações extras da lista', () => {
  it('clicar numa tag do item filtra por ela', async () => {
    mockApi(listing([training(1, { tags: ['promo'] })], { total: 30, totalPages: 2 }));
    render(<AgentTrainingsPage />);
    const item = (await screen.findAllByRole('listitem'))[0]!;
    fireEvent.click(within(item).getByText('promo'));
    expect(replace).toHaveBeenCalledWith('/app/agents/ag1/trainings?tags=promo', {
      scroll: false,
    });
  });

  it('"Limpar filtros" da barra zera a URL', async () => {
    params = new URLSearchParams('status=DONE');
    mockApi(listing([training(1)], { total: 30, totalPages: 2 }));
    render(<AgentTrainingsPage />);
    fireEvent.click(await screen.findByText('Limpar filtros'));
    expect(replace).toHaveBeenCalledWith('/app/agents/ag1/trainings', { scroll: false });
  });

  it('página que não existe mais volta para a última', async () => {
    params = new URLSearchParams('page=5');
    mockApi(listing([], { page: 5, total: 25, totalPages: 2 }));
    render(<AgentTrainingsPage />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/app/agents/ag1/trainings?page=2', { scroll: false }),
    );
  });

  it('treinamento da função oferece só "Tags"', async () => {
    mockApi(listing([training(1, { managed: true, tags: ['promo'] })]));
    render(<AgentTrainingsPage />);
    const item = (await screen.findAllByRole('listitem'))[0]!;
    expect(within(item).queryByText('Tags e prazo')).toBeNull();
    fireEvent.click(within(item).getByText('Tags'));
    expect(await screen.findByRole('button', { name: 'Remover a tag promo' })).toBeTruthy();
  });

  it('"Tags e prazo" abre o modal do item', async () => {
    mockApi(listing([training(1, { tags: ['promo'] })]));
    render(<AgentTrainingsPage />);
    fireEvent.click(await screen.findByText('Tags e prazo'));
    expect(await screen.findByRole('button', { name: 'Remover a tag promo' })).toBeTruthy();
  });
});

describe('idioma da interface', () => {
  afterEach(() => window.localStorage.clear());

  it('em espanhol, a paginação e os filtros saem traduzidos', async () => {
    window.localStorage.setItem('gptthink.locale', 'es');
    mockApi(listing([training(1)], { total: 45, totalPages: 3 }));
    render(
      <I18nProvider>
        <AgentTrainingsPage />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('Página 1 de 3')).toBeTruthy());
    expect(screen.getByText('45 entrenamientos')).toBeTruthy();
    expect(screen.getByLabelText('Buscar entrenamiento')).toBeTruthy();
  });
});
