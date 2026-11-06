import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../shared/database/database.module';
import type { BitrixClient } from '../bitrix';
import type { InboundMessage } from './inbound-message';
import { OutOfHoursHandler } from './out-of-hours.handler';

const message = {
  tenantId: 't1',
  agentId: 'a1',
  dialogId: 'chat1',
  messageId: 10,
  botId: 456,
} as InboundMessage;

function setup(options: { sendFails?: boolean } = {}) {
  const keys = new Map<string, string>();
  const redis = {
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && keys.has(key)) return null;
      keys.set(key, value);
      return 'OK';
    }),
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
  const handler = new OutOfHoursHandler({ call } as unknown as BitrixClient, db, redis);
  return { handler, call, inserted, keys };
}

describe('OutOfHoursHandler', () => {
  it('envia o aviso na primeira mensagem e suprime as seguintes', async () => {
    const { handler, call, inserted } = setup();
    expect(await handler.handle(message, 1, 'Voltamos às 9h', 0)).toBe('notified');
    expect(await handler.handle({ ...message, messageId: 11 }, 1, 'Voltamos às 9h', 0)).toBe(
      'already-notified',
    );
    expect(await handler.handle({ ...message, messageId: 12 }, 1, 'Voltamos às 9h', 0)).toBe(
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
    expect(await handler.handle(message, 1, null, 0)).toBe('silent');
    expect(call).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(1);
  });

  it('falha no envio libera a marca para a retentativa', async () => {
    const { handler, keys } = setup({ sendFails: true });
    await expect(handler.handle(message, 1, 'Fechado', 0)).rejects.toThrow('bitrix fora');
    expect(keys.size).toBe(0);
  });
});
