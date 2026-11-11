import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponsiblePicker, UsersPicker } from './bitrix-pickers';

const select = vi.fn();
// Dentro do Bitrix24 os seletores abrem o diálogo de usuários do portal.
vi.mock('@/lib/bx24', () => ({
  insideBitrix: () => true,
  bx24SelectUsers: () => select(),
}));

beforeEach(() => select.mockReset());
afterEach(cleanup);

describe('ResponsiblePicker dentro do Bitrix24', () => {
  it('mostra o nome do usuário já salvo, e não só o número', () => {
    render(<ResponsiblePicker value={508} knownName="Ana Lima" onChange={() => undefined} />);
    expect(screen.getByText('Ana Lima')).toBeTruthy();
    expect(screen.queryByText('Usuário #508')).toBeNull();
  });

  it('sem o nome, mostra o número; sem usuário, "Nenhum escolhido"', () => {
    const { rerender } = render(<ResponsiblePicker value={508} onChange={() => undefined} />);
    expect(screen.getByText('Usuário #508')).toBeTruthy();
    rerender(<ResponsiblePicker value={0} onChange={() => undefined} />);
    expect(screen.getByText('Nenhum escolhido')).toBeTruthy();
  });

  it('escolher no diálogo devolve o id e passa a mostrar o nome escolhido', async () => {
    select.mockResolvedValue([{ id: '418', name: 'Bruno Reis' }]);
    const onChange = vi.fn();
    render(<ResponsiblePicker value={508} knownName="Ana Lima" onChange={onChange} />);
    fireEvent.click(screen.getByText('Escolher'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(418));
    expect(await screen.findByText('Bruno Reis')).toBeTruthy();
  });
});

describe('UsersPicker dentro do Bitrix24', () => {
  it('mostra os nomes dos usuários já salvos e o texto de ajuda dado', () => {
    render(
      <UsersPicker
        value={[508, 418]}
        knownNames={{ 508: 'Ana Lima' }}
        hint="Se um estiver ocupado, vale o próximo da lista."
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText('Ana Lima')).toBeTruthy();
    // Quem não tem nome conhecido aparece pelo número.
    expect(screen.getByText(/Usuário #418/)).toBeTruthy();
    expect(screen.getByText('Se um estiver ocupado, vale o próximo da lista.')).toBeTruthy();
  });

  it('sem texto de ajuda, mantém o padrão do rodízio (usado nas transferências)', () => {
    render(<UsersPicker value={[]} onChange={() => undefined} />);
    expect(screen.getByText('Recebem um de cada vez, em rodízio.')).toBeTruthy();
  });

  it('respeita o máximo de usuários ao adicionar', async () => {
    select.mockResolvedValue([
      { id: '3', name: 'C' },
      { id: '4', name: 'D' },
      { id: '5', name: 'E' },
    ]);
    const onChange = vi.fn();
    render(<UsersPicker value={[1, 2]} max={4} onChange={onChange} />);
    fireEvent.click(screen.getByText('Adicionar'));
    // Cabem só mais 2: ficam 1, 2, 3 e 4.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([1, 2, 3, 4]));
  });

  it('sem máximo, o limite continua sendo 20', async () => {
    select.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({ id: String(i + 1), name: `U${i}` })),
    );
    const onChange = vi.fn();
    render(<UsersPicker value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByText('Adicionar'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0]![0]).toHaveLength(20);
  });

  it('não repete quem já estava na lista e tira um usuário no ×', async () => {
    select.mockResolvedValue([
      { id: '1', name: 'A' },
      { id: '9', name: 'I' },
    ]);
    const onChange = vi.fn();
    render(<UsersPicker value={[1, 2]} onChange={onChange} />);
    fireEvent.click(screen.getByText('Adicionar'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([1, 2, 9]));

    fireEvent.click(screen.getByRole('button', { name: 'Tirar 2' }));
    expect(onChange).toHaveBeenLastCalledWith([1]);
  });

  it('diálogo fechado sem escolher ninguém não muda a lista', async () => {
    select.mockResolvedValue([]);
    const onChange = vi.fn();
    render(<UsersPicker value={[1]} onChange={onChange} />);
    fireEvent.click(screen.getByText('Adicionar'));
    await waitFor(() => expect(select).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });
});
