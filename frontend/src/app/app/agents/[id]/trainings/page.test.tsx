import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentTrainingsPage from './page';

const api = vi.fn();
vi.mock('../../../session-provider', () => ({
  useAppSession: () => ({ session: { canManage: true }, api: (...a: unknown[]) => api(...a) }),
}));
vi.mock('../agent-context', () => ({
  useAgent: () => ({ agent: { id: 'ag1', status: 'ACTIVE' } }),
}));

const training = (i: number) => ({
  id: `t${i}`,
  type: 'TEXT',
  status: 'TRAINED',
  managed: false,
  text: `Treinamento número ${i}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  image: null,
  document: null,
});

function listing(count: number) {
  return {
    trainings: Array.from({ length: count }, (_, i) => training(i + 1)),
    usage: { trainings: { used: count, limit: null } },
  };
}

beforeEach(() => {
  api.mockReset();
});
afterEach(cleanup);

function mockApi(count: number) {
  api.mockImplementation((path: string) =>
    Promise.resolve(path.endsWith('/function') ? { mode: 'SIMPLE' } : listing(count)),
  );
}

describe('lista de treinamentos longa', () => {
  it('mostra 20 por vez e libera o resto em "Mostrar mais"', async () => {
    mockApi(25);
    render(<AgentTrainingsPage />);
    await waitFor(() => expect(screen.getByText('Mostrando 20 de 25')).toBeTruthy());
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    fireEvent.click(screen.getByText('Mostrar mais'));
    expect(screen.getAllByRole('listitem')).toHaveLength(25);
    expect(screen.queryByText('Mostrar mais')).toBeNull();
  });

  it('a busca filtra pelo título e avisa quando nada é encontrado', async () => {
    mockApi(25);
    render(<AgentTrainingsPage />);
    const search = await screen.findByLabelText('Buscar treinamento');
    fireEvent.change(search, { target: { value: 'número 25' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText(/Nenhum treinamento encontrado/)).toBeTruthy();
  });

  it('lista curta não mostra busca nem "Mostrar mais"', async () => {
    mockApi(5);
    render(<AgentTrainingsPage />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5));
    expect(screen.queryByLabelText('Buscar treinamento')).toBeNull();
    expect(screen.queryByText('Mostrar mais')).toBeNull();
  });
});
