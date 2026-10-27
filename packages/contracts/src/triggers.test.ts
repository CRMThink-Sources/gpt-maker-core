import { describe, expect, it } from 'vitest';
import { intentionActionInputSchema, isUserList } from './triggers';

describe('ações com vários usuários e canal aberto (D15, D16)', () => {
  it('transferir para canal aberto exige o canal', () => {
    const parsed = intentionActionInputSchema.safeParse({
      type: 'TRANSFER_TO_HUMAN',
      config: { target: 'LINE' },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['config', 'lineId']);
    expect(
      intentionActionInputSchema.safeParse({
        type: 'TRANSFER_TO_HUMAN',
        config: { target: 'LINE', lineId: 4 },
      }).success,
    ).toBe(true);
  });

  it('transferir para usuário aceita lista', () => {
    expect(
      intentionActionInputSchema.safeParse({
        type: 'TRANSFER_TO_HUMAN',
        config: { target: 'USER', userId: [3, 5] },
      }).success,
    ).toBe(true);
  });

  it('responsável da tarefa aceita lista não vazia', () => {
    const task = (responsibleId: unknown) =>
      intentionActionInputSchema.safeParse({
        type: 'CREATE_TASK',
        config: { title: 'Chamado', responsibleId },
      }).success;
    expect(task([4, 6])).toBe(true);
    expect(task([])).toBe(false);
    expect(task(4)).toBe(true);
  });

  it('isUserList reconhece a lista', () => {
    expect(isUserList([1, 2])).toBe(true);
    expect(isUserList(1)).toBe(false);
  });
});
