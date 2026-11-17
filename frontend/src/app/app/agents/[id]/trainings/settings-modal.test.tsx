import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrainingView } from '@gptmaker/contracts';
import { AddTrainingModal } from './add-training-modal';
import { TrainingSettingsModal } from './settings-modal';

const api = vi.fn();
vi.mock('../../../session-provider', () => ({
  useAppSession: () => ({ session: { canManage: true }, api: (...a: unknown[]) => api(...a) }),
}));

const site: TrainingView = {
  id: 't1',
  type: 'WEBSITE',
  status: 'DONE',
  managed: false,
  text: null,
  image: null,
  url: 'https://exemplo.com',
  trainingSubPages: false,
  trainingInterval: 'NEVER',
  document: null,
  tags: ['preços'],
  expiresAt: null,
  expiredAt: null,
  error: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const future = (days: number) => new Date(Date.now() + days * 86_400_000);
const localValue = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({});
});
afterEach(cleanup);

const lastBody = () => JSON.parse((api.mock.calls.at(-1)![1] as { body: string }).body);

describe('modal de tags e prazo', () => {
  function open(training: TrainingView = site) {
    const onSaved = vi.fn();
    render(
      <TrainingSettingsModal
        agentId="ag1"
        training={training}
        availableTags={['frete', 'preços']}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    return { onSaved };
  }

  it('só salva depois de mudar algo', () => {
    open();
    expect((screen.getByText('Salvar') as HTMLButtonElement).disabled).toBe(true);
  });

  it('editar só as tags de um site manda só as tags, sem reenviar nada', async () => {
    const { onSaved } = open();
    const input = screen.getByLabelText('Tags');
    fireEvent.change(input, { target: { value: 'Promo' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.mock.calls[0]![0]).toBe('/app/agents/ag1/trainings/t1/settings');
    expect(api.mock.calls[0]![1]).toMatchObject({ method: 'PATCH' });
    expect(lastBody()).toEqual({ tags: ['preços', 'promo'] });
  });

  it('sugestões já usadas entram com um clique; as que já estão no item não aparecem', () => {
    open();
    expect(screen.queryByRole('button', { name: 'preços' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'frete' }));
    expect(screen.getByLabelText('Remover a tag frete')).toBeTruthy();
  });

  it('remove uma tag pelo botão do chip', async () => {
    const { onSaved } = open();
    fireEvent.click(screen.getByLabelText('Remover a tag preços'));
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(lastBody()).toEqual({ tags: [] });
  });

  it('definir a expiração manda a data em ISO; limpar manda null', async () => {
    const date = future(7);
    const { onSaved } = open();
    fireEvent.change(screen.getByLabelText('Expira em'), { target: { value: localValue(date) } });
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(lastBody()).toEqual({ expiresAt: new Date(localValue(date)).toISOString() });

    cleanup();
    api.mockClear();
    const withExpiry = open({ ...site, expiresAt: future(2).toISOString() });
    fireEvent.change(screen.getByLabelText('Expira em'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(withExpiry.onSaved).toHaveBeenCalled());
    expect(lastBody()).toEqual({ expiresAt: null });
  });

  it('data no passado trava o salvamento e avisa', () => {
    open();
    fireEvent.change(screen.getByLabelText('Expira em'), {
      target: { value: localValue(future(-2)) },
    });
    expect(screen.getByText('Escolha uma data futura.')).toBeTruthy();
    expect((screen.getByText('Salvar') as HTMLButtonElement).disabled).toBe(true);
  });

  it('mostra o erro da API sem fechar', async () => {
    api.mockRejectedValue(new Error('x'));
    open();
    fireEvent.click(screen.getByLabelText('Remover a tag preços'));
    fireEvent.click(screen.getByText('Salvar'));
    expect(await screen.findByText('Não foi possível salvar. Tente de novo.')).toBeTruthy();
  });
});

describe('criar treinamento com tags e expiração', () => {
  it('manda as tags normalizadas e a expiração junto da criação', async () => {
    const onCreated = vi.fn();
    const date = future(3);
    render(
      <AddTrainingModal
        agentId="ag1"
        mediaAllowed={false}
        availableTags={[]}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Texto/), { target: { value: 'Promoção de verão' } });
    const tags = screen.getByLabelText('Tags');
    fireEvent.change(tags, { target: { value: 'Promo, VERÃO,promo' } });
    fireEvent.keyDown(tags, { key: 'Enter' });
    fireEvent.change(screen.getByLabelText('Expira em'), { target: { value: localValue(date) } });
    fireEvent.click(screen.getByText('Adicionar'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(api.mock.calls[0]![0]).toBe('/app/agents/ag1/trainings');
    expect(lastBody()).toEqual({
      type: 'TEXT',
      text: 'Promoção de verão',
      tags: ['promo', 'verão'],
      expiresAt: new Date(localValue(date)).toISOString(),
    });
  });

  it('sem tags nem expiração, o corpo não leva os campos', async () => {
    const onCreated = vi.fn();
    render(
      <AddTrainingModal
        agentId="ag1"
        mediaAllowed={false}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Texto/), { target: { value: 'Oi' } });
    fireEvent.click(screen.getByText('Adicionar'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(lastBody()).toEqual({ type: 'TEXT', text: 'Oi' });
  });
});

describe('teclado do editor de tags', () => {
  function openEmpty() {
    render(
      <TrainingSettingsModal
        agentId="ag1"
        training={{ ...site, tags: [] }}
        availableTags={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    return screen.getByLabelText('Tags');
  }

  it('vírgula adiciona e Backspace no campo vazio remove a última', () => {
    const input = openEmpty();
    fireEvent.change(input, { target: { value: 'promo' } });
    fireEvent.keyDown(input, { key: ',' });
    fireEvent.change(input, { target: { value: 'frete' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByLabelText('Remover a tag promo')).toBeTruthy();
    expect(screen.getByLabelText('Remover a tag frete')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(screen.queryByLabelText('Remover a tag frete')).toBeNull();
    expect(screen.getByLabelText('Remover a tag promo')).toBeTruthy();
  });

  it('para de aceitar tags ao chegar em 10', () => {
    const input = openEmpty();
    for (let i = 0; i < 12; i++) {
      fireEvent.change(input, { target: { value: `t${i}` } });
      fireEvent.keyDown(input, { key: 'Enter' });
    }
    expect(screen.getAllByLabelText(/^Remover a tag/)).toHaveLength(10);
    expect((input as HTMLInputElement).disabled).toBe(true);
  });
});
