import { describe, expect, it } from 'vitest';
import { createTriggerSchema, intentionActionInputSchema, isUserList } from './triggers';

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

/** Cópia sem uma chave. */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

describe('item de SPA (CREATE_SPA_ITEM)', () => {
  const spa = (config: Record<string, unknown>) =>
    intentionActionInputSchema.safeParse({ type: 'CREATE_SPA_ITEM', config });
  const valid = {
    entityTypeId: 1204,
    categoryId: 180,
    stageId: 'DT1204_180:NEW',
    title: 'Chamado: {{fields.resumo}}',
    fields: {
      ufCrm136_1: 'CHAT',
      ufCrm136_2: '{{fields.prioridade}}',
      ufCrm136_3: '{{dialog.chatId}}',
    },
    lists: { ufCrm136_2: { HIGH: 103, LOW: 101 } },
  };

  it('aceita a configuração completa e sem funil, etapa e listas', () => {
    expect(spa(valid).success).toBe(true);
    expect(spa({ entityTypeId: 1204, title: 'Chamado', fields: {} }).success).toBe(true);
  });

  it('exige o SPA', () => {
    const rest = omit(valid, 'entityTypeId');
    expect(spa(rest).error?.issues[0]?.path).toEqual(['config', 'entityTypeId']);
  });

  it('item de lista é id positivo', () => {
    expect(spa({ ...valid, lists: { ufCrm136_2: { HIGH: 0 } } }).success).toBe(false);
    expect(spa({ ...valid, lists: { ufCrm136_2: { HIGH: '103' } } }).success).toBe(false);
  });

  it('não existe nos gatilhos', () => {
    expect(
      createTriggerSchema.safeParse({
        name: 'x',
        event: 'onNewMessage',
        actions: [{ type: 'CREATE_SPA_ITEM', config: valid }],
      }).success,
    ).toBe(false);
  });
});
