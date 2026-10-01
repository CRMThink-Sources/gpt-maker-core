import { describe, expect, it } from 'vitest';
import { webhooksMatch } from '../agents/agent-webhooks.sync';
import { hashWebhookToken, webhookUrlsFor } from '../agents/agent.service';
import { dialogIdFrom, isWebhookEvent } from './agent-event.intake';

const TENANT = '3a228374-7415-4001-8a30-fe1e64ac2755';

describe('webhooks do GPTMaker', () => {
  it.each([
    ['contextId na raiz', { contextId: `${TENANT}:chat9498` }, 'chat9498'],
    ['um nível abaixo', { chat: { contextId: `${TENANT}:chat1` } }, 'chat1'],
    ['outro nome com context', { context_id: `${TENANT}:chat2` }, 'chat2'],
    ['de outro tenant', { contextId: 'outro:chat3' }, null],
    ['sem contextId', { message: 'oi' }, null],
    ['payload não objeto', 'texto', null],
    ['fundo demais', { a: { b: { contextId: `${TENANT}:chat4` } } }, null],
  ])('diálogo: %s', (_name, payload, expected) => {
    expect(dialogIdFrom(payload, TENANT)).toBe(expected);
  });

  it('só os 8 eventos conhecidos', () => {
    expect(isWebhookEvent('onTransfer')).toBe(true);
    expect(isWebhookEvent('onLackKnowLedge')).toBe(true);
    expect(isWebhookEvent('onlackknowledge')).toBe(false);
    expect(isWebhookEvent('outro')).toBe(false);
  });

  describe('webhooks configurados batem com esta API', () => {
    const base = 'https://api.exemplo.com';
    const token = 'tok-123/+=';
    const urls = webhookUrlsFor(base, token);

    it('mesmo endereço e mesmo token', () => {
      expect(webhooksMatch(urls, base, hashWebhookToken(token))).toBe(true);
    });

    it('endereço antigo (túnel trocado)', () => {
      expect(webhooksMatch(urls, 'https://novo.trycloudflare.com', hashWebhookToken(token))).toBe(
        false,
      );
    });

    it('token diferente do guardado', () => {
      expect(webhooksMatch(urls, base, hashWebhookToken('outro'))).toBe(false);
    });

    it('evento faltando ou vazio', () => {
      expect(webhooksMatch({ ...urls, onTransfer: null }, base, hashWebhookToken(token))).toBe(
        false,
      );
      const partial = Object.fromEntries(
        Object.entries(urls).filter(([event]) => event !== 'onCancelEvent'),
      );
      expect(webhooksMatch(partial, base, hashWebhookToken(token))).toBe(false);
    });
  });
});
