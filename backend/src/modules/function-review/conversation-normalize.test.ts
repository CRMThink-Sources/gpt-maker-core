import { describe, expect, it } from 'vitest';
import {
  chatIdPrefix,
  classifyChat,
  dialogOfChat,
  normalizeRole,
  normalizeTime,
} from './conversation-normalize';

const scope = { gptmakerAgentId: 'AG1', tenantId: '11111111-1111-1111-1111-111111111111' };
const T = scope.tenantId;
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';

describe('papel da mensagem', () => {
  it.each([
    ['assistant', 'AGENT'],
    ['Assistant', 'AGENT'],
    ['bot', 'AGENT'],
    ['user', 'CUSTOMER'],
    ['USER', 'CUSTOMER'],
    ['customer', 'CUSTOMER'],
    ['system', 'OTHER'],
    ['human_agent', 'OTHER'],
    ['', 'OTHER'],
  ])('%s → %s', (role, expected) => {
    expect(normalizeRole(role)).toBe(expected);
  });

  it('papel ausente é OUTRO e nunca conta como resposta do agente', () => {
    expect(normalizeRole(undefined)).toBe('OTHER');
    expect(normalizeRole(null)).toBe('OTHER');
  });
});

describe('tempo da mensagem', () => {
  it('época em segundos e em milissegundos dão a mesma data', () => {
    const seconds = normalizeTime(1_700_000_000);
    const millis = normalizeTime(1_700_000_000_000);
    expect(seconds?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(millis?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it.each([[undefined], [null], [0], [-5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'tempo inutilizável (%s) vira null',
    (time) => {
      expect(normalizeTime(time as number | null | undefined)).toBeNull();
    },
  );
});

describe('chat do agente do tenant', () => {
  const id = (dialog: string, agent = 'AG1', tenant = T) =>
    `public-api-${agent}-${tenant}:${dialog}`;

  it('prefixo é público-api, agente e tenant', () => {
    expect(chatIdPrefix(scope)).toBe(`public-api-AG1-${T}:`);
  });

  it('conversa real: diálogo do Bitrix', () => {
    expect(classifyChat({ id: id('chat123'), recipient: `${T}:chat123` }, scope)).toBe('REAL');
    expect(dialogOfChat({ id: id('chat123') }, scope)).toBe('chat123');
  });

  it('conversa de teste: diálogo t-<chave>', () => {
    expect(classifyChat({ id: id('t-0123456789'), recipient: `${T}:t-0123456789` }, scope)).toBe(
      'TEST',
    );
  });

  it('sem recipient, vale só o id', () => {
    expect(classifyChat({ id: id('chat123') }, scope)).toBe('REAL');
    expect(classifyChat({ id: id('chat123'), recipient: null }, scope)).toBe('REAL');
  });

  it.each([
    ['de outro tenant', { id: id('chat123', 'AG1', OTHER_TENANT) }],
    ['de outro agente', { id: id('chat123', 'AG2') }],
    ['sem diálogo', { id: id('') }],
    ['sem o prefixo', { id: 'chat123' }],
    ['id de outro formato', { id: `web-AG1-${T}:chat123` }],
    [
      'recipient de outro tenant com id do tenant',
      { id: id('chat123'), recipient: `${OTHER_TENANT}:chat123` },
    ],
    ['recipient de outro diálogo', { id: id('chat123'), recipient: `${T}:chat999` }],
    ['id do tenant no meio', { id: `public-api-AG1-x${T}:chat123` }],
  ])('descarta chat %s', (_nome, chat) => {
    expect(classifyChat(chat, scope)).toBeNull();
  });

  it('prefixo parecido não casa (tenant que começa igual)', () => {
    const longer = { gptmakerAgentId: 'AG1', tenantId: `${T}9` };
    expect(classifyChat({ id: id('chat123') }, longer)).toBeNull();
  });

  it('diálogo que lembra um teste só é teste com o prefixo t-', () => {
    expect(classifyChat({ id: id('test-1') }, scope)).toBe('REAL');
    expect(classifyChat({ id: id('t-1') }, scope)).toBe('TEST');
  });
});
