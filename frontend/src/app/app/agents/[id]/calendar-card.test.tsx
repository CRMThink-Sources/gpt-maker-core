import type { CalendarConfigView } from '@gptmaker/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_ACCESS_CHANGED_EVENT } from '@/lib/crm';
import { ApiRequestError } from '@/lib/platform-session';
import { CalendarCard } from './calendar-card';

const api = vi.fn();
let session: { canManage: boolean; features?: { crmTools?: boolean } };
let agent: { id: string; name: string; status: string };
// A mesma função a cada render, como o `api` da sessão real: o efeito não pode recarregar à toa.
const stableApi = (...a: unknown[]) => api(...a);
vi.mock('../../session-provider', () => ({
  useAppSession: () => ({ session, api: stableApi }),
}));
vi.mock('./agent-context', () => ({ useAgent: () => ({ agent }) }));
// Fora do Bitrix24 não há `BX24`: os seletores caem nos campos de id, que o teste digita.
vi.mock('@/lib/portal-users', () => ({
  userNames: async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, id === '508' ? 'Ana Lima' : `Usuário ${id}`])),
}));

const view = (patch: Partial<CalendarConfigView> = {}): CalendarConfigView => ({
  config: null,
  crmConnected: true,
  scopeMissing: false,
  ...patch,
});
const saved = (patch: Record<string, unknown> = {}): CalendarConfigView =>
  view({
    config: {
      mode: 'FIXED_USER',
      userIds: [508],
      slotMinutes: 30,
      minNoticeMinutes: 60,
      maxDaysAhead: 7,
      ...patch,
    } as never,
  });

beforeEach(() => {
  api.mockReset();
  session = { canManage: true, features: { crmTools: true } };
  agent = { id: 'ag1', name: 'Ana', status: 'ACTIVE' };
});
afterEach(cleanup);

/** Respostas por método e caminho da API. */
function mockApi(initial: CalendarConfigView, handlers: Record<string, unknown> = {}) {
  api.mockImplementation((path: string, init?: { method?: string }) => {
    const key = init?.method ?? 'GET';
    const handler = handlers[key];
    if (key !== 'GET' && handler !== undefined) {
      return handler instanceof Error ? Promise.reject(handler) : Promise.resolve(handler);
    }
    return Promise.resolve(initial);
  });
}
const body = (call: number) => JSON.parse(api.mock.calls[call]![1].body as string);
const writes = () => api.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');

describe('bloco Agenda do agente', () => {
  it('recurso desligado no ambiente: o bloco não aparece nem consulta a API', async () => {
    session = { canManage: true, features: { crmTools: false } };
    const { container } = render(<CalendarCard />);
    await act(async () => {});
    expect(container.innerHTML).toBe('');
    expect(api).not.toHaveBeenCalled();
  });

  it('sem agenda: explica o que ela faz e oferece configurar', async () => {
    mockApi(view());
    render(<CalendarCard />);
    expect(await screen.findByText('Não configurada')).toBeTruthy();
    expect(screen.getByText(/horários livres no Calendário do Bitrix24/)).toBeTruthy();
    expect(screen.getByText('O agente ainda não oferece nem marca horários.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Configurar agenda' })).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/app/agents/ag1/calendar');
  });

  it('com agenda: mostra de quem é, com o nome do usuário, e as regras dos horários', async () => {
    mockApi(saved());
    render(<CalendarCard />);
    expect(await screen.findByText('Configurada')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Usuário fixo — Ana Lima/)).toBeTruthy());
    expect(
      screen.getByText(
        'Compromissos de 30 minutos · antecedência mínima: 1 hora · busca de até 7 dias à frente.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Editar agenda' })).toBeTruthy();
  });

  it('responsável do cliente: o resumo diz que a agenda é de quem cuida do cliente', async () => {
    mockApi(saved({ mode: 'CLIENT_OWNER', userIds: [], minNoticeMinutes: 0, maxDaysAhead: 1 }));
    render(<CalendarCard />);
    expect(
      await screen.findByText(/Responsável do cliente no CRM — o responsável pelo cliente no CRM/),
    ).toBeTruthy();
    expect(screen.getByText(/sem antecedência · busca de até 1 dia à frente/)).toBeTruthy();
  });

  it('enquanto a primeira leitura não chega: mostra que está carregando', async () => {
    api.mockReturnValue(new Promise(() => undefined));
    render(<CalendarCard />);
    expect(screen.getByRole('status').textContent).toContain('Carregando a agenda');
  });

  it('erro ao carregar: mostra o aviso e deixa tentar de novo', async () => {
    api.mockRejectedValueOnce(new Error('rede'));
    api.mockResolvedValue(view());
    render(<CalendarCard />);
    expect(await screen.findByText('Não foi possível carregar a agenda do agente.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Configurar agenda' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('button', { name: 'Configurar agenda' })).toBeTruthy();
    expect(screen.queryByText('Não foi possível carregar a agenda do agente.')).toBeNull();
  });
});

describe('configurar a agenda', () => {
  async function openForm(initial: CalendarConfigView = view()) {
    mockApi(initial, { PUT: saved() });
    render(<CalendarCard />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: initial.config ? 'Editar agenda' : 'Configurar agenda',
      }),
    );
  }
  const idsField = () => screen.getByLabelText(/^Quem atende/) as HTMLInputElement;
  const duration = () => screen.getByLabelText(/Duração do compromisso/) as HTMLInputElement;

  it('usuário fixo: salva o usuário com os padrões e mostra o resumo', async () => {
    await openForm();
    fireEvent.change(idsField(), { target: { value: '508' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agenda' }));

    await waitFor(() => expect(screen.getByText('Configurada')).toBeTruthy());
    expect(writes()).toHaveLength(1);
    expect(api.mock.calls.at(-1)![0]).toBe('/app/agents/ag1/calendar');
    const call = api.mock.calls.findIndex(([, init]) => init?.method === 'PUT');
    expect(body(call)).toEqual({
      mode: 'FIXED_USER',
      userIds: [508],
      slotMinutes: 30,
      minNoticeMinutes: 60,
      maxDaysAhead: 7,
    });
    // O formulário fecha e o resumo aparece.
    expect(screen.queryByRole('button', { name: 'Salvar agenda' })).toBeNull();
    expect(await screen.findByText(/Usuário fixo — Ana Lima/)).toBeTruthy();
  });

  it('lista de usuários: salva os ids na ordem digitada', async () => {
    await openForm();
    fireEvent.click(screen.getByLabelText(/Lista de usuários/));
    fireEvent.change(idsField(), { target: { value: '418, 508' } });
    fireEvent.change(duration(), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agenda' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const call = api.mock.calls.findIndex(([, init]) => init?.method === 'PUT');
    expect(body(call)).toMatchObject({ mode: 'USER_LIST', userIds: [418, 508], slotMinutes: 45 });
  });

  it('responsável do cliente: não pede usuário e salva sem usuários', async () => {
    await openForm();
    fireEvent.click(screen.getByLabelText(/Responsável do cliente no CRM/));
    expect(screen.queryByLabelText(/^Quem atende/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agenda' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    const call = api.mock.calls.findIndex(([, init]) => init?.method === 'PUT');
    expect(body(call)).toMatchObject({ mode: 'CLIENT_OWNER', userIds: [] });
  });

  it('trocar de usuário fixo para responsável do cliente descarta o usuário escolhido', async () => {
    await openForm();
    fireEvent.change(idsField(), { target: { value: '508' } });
    fireEvent.click(screen.getByLabelText(/Responsável do cliente no CRM/));
    fireEvent.click(screen.getByLabelText(/Usuário fixo/));
    expect((idsField() as HTMLInputElement).value).toBe('');
  });

  it.each([
    ['usuário fixo sem escolher ninguém', () => undefined, 'exatamente 1 usuário'],
    [
      'duração de 10 minutos',
      () => {
        fireEvent.change(screen.getByLabelText(/^Quem atende/), { target: { value: '508' } });
        fireEvent.change(screen.getByLabelText(/Duração do compromisso/), {
          target: { value: '10' },
        });
      },
      'A duração mínima é de 15 minutos',
    ],
    [
      'duração fora do múltiplo de 5',
      () => {
        fireEvent.change(screen.getByLabelText(/^Quem atende/), { target: { value: '508' } });
        fireEvent.change(screen.getByLabelText(/Duração do compromisso/), {
          target: { value: '32' },
        });
      },
      'múltiplos de 5',
    ],
    [
      'janela de 31 dias',
      () => {
        fireEvent.change(screen.getByLabelText(/^Quem atende/), { target: { value: '508' } });
        fireEvent.change(screen.getByLabelText(/Procurar horários até/), {
          target: { value: '31' },
        });
      },
      'A janela máxima é de 30 dias',
    ],
    [
      'campo numérico vazio',
      () => {
        fireEvent.change(screen.getByLabelText(/^Quem atende/), { target: { value: '508' } });
        fireEvent.change(screen.getByLabelText(/Antecedência mínima/), { target: { value: '' } });
      },
      'Preencha a duração, a antecedência e a janela com números.',
    ],
  ])('valida antes de enviar (%s)', async (_caso, fill, message) => {
    await openForm();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agenda' }));
    expect(await screen.findByText(new RegExp(message))).toBeTruthy();
    expect(writes()).toEqual([]);
  });

  it('lista com mais de 10 usuários: recusa com a mensagem do contrato', async () => {
    await openForm();
    fireEvent.click(screen.getByLabelText(/Lista de usuários/));
    fireEvent.change(idsField(), { target: { value: '1,2,3,4,5,6,7,8,9,10,11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agenda' }));
    expect(await screen.findByText(/de 1 a 10 usuários/)).toBeTruthy();
    expect(writes()).toEqual([]);
  });

  it('usuário inexistente ou inativo: mostra a mensagem e mantém o formulário preenchido', async () => {
    mockApi(view(), {
      PUT: new ApiRequestError(422, 'CALENDAR_USER_INVALID', 'texto técnico', { userIds: [999] }),
    });
    render(<CalendarCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configurar agenda' }));
    fireEvent.change(idsField(), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agenda' }));

    expect(await screen.findByText(/não existem no Bitrix24 ou estão inativos/)).toBeTruthy();
    expect((idsField() as HTMLInputElement).value).toBe('999');
    expect(screen.getByRole('button', { name: 'Salvar agenda' })).toBeTruthy();
  });

  it('Bitrix24 fora do ar ao salvar: pede para tentar de novo', async () => {
    mockApi(view(), {
      PUT: new ApiRequestError(502, 'CALENDAR_PORTAL_UNAVAILABLE', 'x'),
    });
    render(<CalendarCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configurar agenda' }));
    fireEvent.change(idsField(), { target: { value: '508' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agenda' }));
    expect(await screen.findByText(/O Bitrix24 não respondeu agora/)).toBeTruthy();
  });

  it('cancelar fecha o formulário sem enviar nada', async () => {
    await openForm();
    fireEvent.change(idsField(), { target: { value: '508' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('button', { name: 'Salvar agenda' })).toBeNull();
    expect(writes()).toEqual([]);
  });

  it('editar abre o formulário com os valores salvos', async () => {
    await openForm(saved({ slotMinutes: 45, maxDaysAhead: 14 }));
    expect(duration().value).toBe('45');
    expect((screen.getByLabelText(/Procurar horários até/) as HTMLInputElement).value).toBe('14');
    expect((screen.getByLabelText(/Usuário fixo/) as HTMLInputElement).checked).toBe(true);
  });
});

describe('remover a agenda', () => {
  it('pede confirmação e só então remove', async () => {
    mockApi(saved(), { DELETE: view() });
    render(<CalendarCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar agenda' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover agenda' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/compromissos que já foram marcados/)).toBeTruthy();
    expect(writes()).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(screen.getByText('Não configurada')).toBeTruthy());
    expect(writes()).toHaveLength(1);
    expect(writes()[0]![1].method).toBe('DELETE');
  });

  it('cancelar a confirmação não remove nada', async () => {
    mockApi(saved(), { DELETE: view() });
    render(<CalendarCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar agenda' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover agenda' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    );
    expect(writes()).toEqual([]);
    expect(screen.getByText('Configurada')).toBeTruthy();
  });
});

describe('avisos e permissões', () => {
  it('sem o escopo do Calendário: pede para reautorizar o aplicativo', async () => {
    mockApi({ ...saved(), scopeMissing: true });
    render(<CalendarCard />);
    expect(await screen.findByText(/recusou o acesso ao Calendário/)).toBeTruthy();
    expect(screen.getByText(/reautorizar o aplicativo/)).toBeTruthy();
  });

  it('sem o acesso ao CRM ligado: avisa e não deixa configurar', async () => {
    mockApi(view({ crmConnected: false }));
    render(<CalendarCard />);
    expect(
      await screen.findByText(/só funciona com o acesso ao CRM deste agente ligado/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Configurar agenda' })).toBeNull();
  });

  it('quem só consulta vê o resumo, sem botões de alterar', async () => {
    session = { canManage: false, features: { crmTools: true } };
    mockApi(saved());
    render(<CalendarCard />);
    expect(await screen.findByText('Configurada')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('agente fora de sincronia no GPTMaker: não deixa alterar', async () => {
    agent = { ...agent, status: 'OUT_OF_SYNC' };
    mockApi(view());
    render(<CalendarCard />);
    expect(await screen.findByText('Não configurada')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Configurar agenda' })).toBeNull();
    // E explica por quê, em vez de só esconder o botão.
    expect(screen.getByText(/O agente não foi encontrado no GPTMaker/)).toBeTruthy();
  });

  it('quem não pode gerenciar não vê o aviso de agente fora de sincronia', async () => {
    session = { canManage: false, features: { crmTools: true } };
    agent = { ...agent, status: 'OUT_OF_SYNC' };
    mockApi(view());
    render(<CalendarCard />);
    expect(await screen.findByText('Não configurada')).toBeTruthy();
    expect(screen.queryByText(/O agente não foi encontrado no GPTMaker/)).toBeNull();
  });

  it('o acesso ao CRM foi ligado no bloco ao lado: relê o estado e libera a configuração', async () => {
    api.mockResolvedValueOnce(view({ crmConnected: false }));
    api.mockResolvedValueOnce(view({ crmConnected: true }));
    render(<CalendarCard />);
    expect(await screen.findByText(/só funciona com o acesso ao CRM/)).toBeTruthy();

    window.dispatchEvent(new Event(CRM_ACCESS_CHANGED_EVENT));
    expect(await screen.findByRole('button', { name: 'Configurar agenda' })).toBeTruthy();
    expect(screen.queryByText(/só funciona com o acesso ao CRM/)).toBeNull();
    expect(api).toHaveBeenCalledTimes(2);
  });
});

describe('leituras que chegam atrasadas ou falham', () => {
  it('uma leitura lenta que termina depois de salvar não desfaz o que foi salvo', async () => {
    let finishSlow!: (v: CalendarConfigView) => void;
    api
      .mockResolvedValueOnce(view()) // primeira leitura
      .mockReturnValueOnce(new Promise((resolve) => (finishSlow = resolve))) // disparada pelo CRM, lenta
      .mockResolvedValueOnce(saved()); // o PUT
    render(<CalendarCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Configurar agenda' }));
    act(() => void window.dispatchEvent(new Event(CRM_ACCESS_CHANGED_EVENT)));

    fireEvent.change(screen.getByLabelText(/^Quem atende/), { target: { value: '508' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar agenda' }));
    expect(await screen.findByText('Configurada')).toBeTruthy();

    // A leitura antiga, de antes de salvar, chega agora com "sem agenda".
    await act(async () => finishSlow(view()));
    expect(screen.getByText('Configurada')).toBeTruthy();
    expect(screen.queryByText('Não configurada')).toBeNull();
  });

  it('uma leitura lenta que termina depois de remover não traz a agenda de volta', async () => {
    let finishSlow!: (v: CalendarConfigView) => void;
    api
      .mockResolvedValueOnce(saved())
      .mockReturnValueOnce(new Promise((resolve) => (finishSlow = resolve)))
      .mockResolvedValueOnce(view()); // o DELETE
    render(<CalendarCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar agenda' }));
    act(() => void window.dispatchEvent(new Event(CRM_ACCESS_CHANGED_EVENT)));
    fireEvent.click(screen.getByRole('button', { name: 'Remover agenda' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remover' }),
    );
    expect(await screen.findByText('Não configurada')).toBeTruthy();

    await act(async () => finishSlow(saved()));
    expect(screen.getByText('Não configurada')).toBeTruthy();
  });

  it('falha ao reler depois de já ter carregado: mantém o card, avisa e deixa tentar de novo', async () => {
    api.mockResolvedValueOnce(saved()).mockRejectedValueOnce(new Error('rede'));
    api.mockResolvedValue(saved());
    render(<CalendarCard />);
    expect(await screen.findByText('Configurada')).toBeTruthy();

    act(() => void window.dispatchEvent(new Event(CRM_ACCESS_CHANGED_EVENT)));
    expect(await screen.findByText(/Não foi possível carregar a agenda do agente./)).toBeTruthy();
    // O card continua na tela, com o aviso de que pode estar desatualizado.
    expect(screen.getByText(/pode estar desatualizado/)).toBeTruthy();
    expect(screen.getByText('Configurada')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(screen.queryByText(/pode estar desatualizado/)).toBeNull());
    expect(screen.getByText('Configurada')).toBeTruthy();
  });
});
