import { describe, expect, it } from 'vitest';
import {
  AGENT_TEST_MESSAGE_MAX,
  newTestConversationSchema,
  testMessageInputSchema,
} from './agent-tests';

describe('contratos do teste do agente', () => {
  it('mensagem: obrigatória, aparada e com limite', () => {
    expect(testMessageInputSchema.parse({ text: '  Olá  ' })).toEqual({ text: 'Olá' });
    expect(testMessageInputSchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(
      testMessageInputSchema.safeParse({ text: 'x'.repeat(AGENT_TEST_MESSAGE_MAX + 1) }).success,
    ).toBe(false);
  });

  it('nova conversa: cliente simulado opcional e validado', () => {
    expect(newTestConversationSchema.parse({})).toEqual({ client: null });
    expect(
      newTestConversationSchema.parse({ client: { type: 'contact', id: 12, name: 'Maria' } }),
    ).toEqual({ client: { type: 'contact', id: 12, name: 'Maria' } });
    expect(
      newTestConversationSchema.safeParse({ client: { type: 'deal', id: 12, name: 'X' } }).success,
    ).toBe(false);
    expect(
      newTestConversationSchema.safeParse({ client: { type: 'lead', id: 0, name: 'X' } }).success,
    ).toBe(false);
  });
});
