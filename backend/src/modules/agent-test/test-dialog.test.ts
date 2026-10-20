import { describe, expect, it } from 'vitest';
import { isTestDialog, testContextId, testConversationIdFrom } from './test-dialog';

const ID = '0b7c4f0e-8d1f-4a3b-9c2d-1e2f3a4b5c6d';

describe('diálogo de teste', () => {
  it('contexto e diálogo', () => {
    expect(testContextId('t1', ID)).toBe(`t1:test-${ID}`);
    expect(isTestDialog(`test-${ID}`)).toBe(true);
    expect(isTestDialog('chat9500')).toBe(false);
    expect(isTestDialog(null)).toBe(false);
  });

  it('id só quando é um UUID', () => {
    expect(testConversationIdFrom(`test-${ID}`)).toBe(ID);
    expect(testConversationIdFrom('test-abc')).toBeNull();
    expect(testConversationIdFrom('chat9500')).toBeNull();
  });
});
