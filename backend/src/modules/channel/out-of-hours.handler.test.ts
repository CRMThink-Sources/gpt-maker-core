import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../shared/database/database.module';
import type { BitrixClient } from '../bitrix';
import type { HumanHandoff } from './human-handoff';
import type { InboundMessage } from './inbound-message';
import { OutOfHoursHandler } from './out-of-hours.handler';

const message = {
  tenantId: 't1',
  agentId: 'a1',
  dialogId: 'chat1',
  messageId: 10,
  botId: 456,
} as InboundMessage;

function setup(options: { sendFails?: boolean; handoffFails?: boolean } = {}) {
  const keys = new Map<string, string>();
  const redis = {
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && keys.has(key)) return null;
      keys.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => keys.get(key) ?? null),
    del: vi.fn(async (key: string) => void keys.delete(key)),
  } as unknown as Redis;
  const inserted: unknown[] = [];
  const db = {
    insert: () => ({
      values: (row: unknown) => {
        inserted.push(row);
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  } as unknown as Database;
  const call = vi.fn(async () => {
    if (options.sendFails) throw new Error('bitrix fora');
    return { result: {} };
  });
  const start = vi.fn(async () => {
    if (options.handoffFails) throw new Error('bitrix fora');
    return 'started';
  });
  const handler = new OutOfHoursHandler({ call } as unknown as BitrixClient, db, redis, {
    start,
  } as unknown as HumanHandoff);
  return { handler, call, start, inserted, keys };
}

describe('OutOfHoursHandler', () => {
  it('envia o aviso na primeira mensagem e suprime as seguintes', async () => {
    const { handler, call, inserted } = setup();
    expect(await handler.handle(message, 1, 'Voltamos às 9h', false, 0)).toBe('notified');
    expect(await handler.handle({ ...message, messageId: 11 }, 1, 'Voltamos às 9h', false, 0)).toBe(
      'already-notified',
    );
    expect(await handler.handle({ ...message, messageId: 12 }, 1, 'Voltamos às 9h', false, 0)).toBe(
      'already-notified',
    );
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(1, 'imbot.v2.Chat.Message.send', {
      botId: 456,
      dialogId: 'chat1',
      fields: { message: 'Voltamos às 9h' },
    });
    expect(inserted).toHaveLength(3);
    expect(inserted[0]).toMatchObject({ status: 'SKIPPED_OUT_OF_HOURS', direction: 'IN' });
  });

  it('sem texto configurado, fica em silêncio mas registra', async () => {
    const { handler, call, inserted } = setup();
    expect(await handler.handle(message, 1, null, false, 0)).toBe('silent');
    expect(call).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(1);
  });

  it('falha no envio libera a marca para a retentativa', async () => {
    const { handler, keys } = setup({ sendFails: true });
    await expect(handler.handle(message, 1, 'Fechado', false, 0)).rejects.toThrow('bitrix fora');
    expect(keys.size).toBe(0);
  });

  describe('com transferência', () => {
    it('transfere sem avisar quando não há texto', async () => {
      const { handler, call, start, inserted } = setup();
      expect(await handler.handle(message, 1, null, true, 0)).toBe('transferred');
      expect(call).not.toHaveBeenCalled();
      expect(start).toHaveBeenCalledWith({ tenantId: 't1', agentId: 'a1', dialogId: 'chat1' });
      expect(inserted[0]).toMatchObject({ status: 'SKIPPED_OUT_OF_HOURS' });
    });

    it('avisa e depois transfere', async () => {
      const { handler, call, start } = setup();
      const order: string[] = [];
      call.mockImplementation(async () => {
        order.push('aviso');
        return { result: {} };
      });
      start.mockImplementation(async () => {
        order.push('transferencia');
        return 'started';
      });
      expect(await handler.handle(message, 1, 'Voltamos às 9h', true, 0)).toBe('transferred');
      expect(order).toEqual(['aviso', 'transferencia']);
    });

    it('falha na transferência: a retentativa não repete o aviso', async () => {
      const { handler, call, start } = setup({ handoffFails: true });
      await expect(handler.handle(message, 1, 'Voltamos às 9h', true, 0)).rejects.toThrow(
        'bitrix fora',
      );
      start.mockResolvedValueOnce('started');
      expect(await handler.handle(message, 1, 'Voltamos às 9h', true, 1)).toBe('transferred');
      expect(call).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledTimes(2);
    });

    it('depois da transferência a marca sai: novo ciclo avisa de novo', async () => {
      const { handler, call, keys } = setup();
      await handler.handle(message, 1, 'Voltamos às 9h', true, 0);
      expect(keys.size).toBe(0);
      await handler.handle({ ...message, messageId: 11 }, 1, 'Voltamos às 9h', true, 0);
      expect(call).toHaveBeenCalledTimes(2);
    });
  });
});
