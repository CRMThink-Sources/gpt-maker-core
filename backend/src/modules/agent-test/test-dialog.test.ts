import { describe, expect, it } from 'vitest';
import {
  isTestDialog,
  newTestDialogKey,
  testContextId,
  testDialogKeyFrom,
  testDialogOf,
} from './test-dialog';

const TENANT = '160df64a-ade7-4ccf-83d3-2905ea1d0d48';

describe('diálogo de teste', () => {
  it('contexto curto: até 50 caracteres (o GPTMaker falha com contexto longo)', () => {
    const key = newTestDialogKey();
    const context = testContextId(TENANT, key);
    expect(context).toBe(`${TENANT}:t-${key}`);
    expect(context.length).toBeLessThanOrEqual(50);
    expect(testDialogOf(context)).toBe(`t-${key}`);
  });

  it('reconhece o diálogo de teste e extrai a chave', () => {
    expect(isTestDialog('t-0a1b2c3d4e')).toBe(true);
    expect(isTestDialog('chat9500')).toBe(false);
    expect(isTestDialog(null)).toBe(false);
    expect(testDialogKeyFrom('t-0a1b2c3d4e')).toBe('0a1b2c3d4e');
    expect(testDialogKeyFrom('t-curta')).toBeNull();
    expect(testDialogKeyFrom('chat9500')).toBeNull();
  });

  it('chaves diferentes a cada conversa', () => {
    const keys = new Set(Array.from({ length: 100 }, () => newTestDialogKey()));
    expect(keys.size).toBe(100);
  });
});
