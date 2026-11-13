import { LOCALES } from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { MESSAGES, toLocale } from './messages';

describe('MESSAGES por idioma', () => {
  it.each([
    ['pt-BR', 'Restam'],
    ['en', 'left'],
    ['es', 'Quedan'],
  ] as const)('credit80 em %s', (locale, trecho) => {
    const text = MESSAGES.credit80(locale, { consumedPercent: 80, remaining: 1200 });
    expect(text).toContain('80%');
    expect(text).toContain(trecho);
  });

  it('formata o saldo conforme o idioma', () => {
    expect(MESSAGES.credit80('en', { consumedPercent: 80, remaining: 1200 })).toContain('1,200');
    expect(MESSAGES.credit80('pt-BR', { consumedPercent: 80, remaining: 1200 })).toContain('1.200');
  });

  it('todas as mensagens existem nos três idiomas e são distintas', () => {
    const texts = LOCALES.map((locale) => [
      MESSAGES.creditZero(locale),
      MESSAGES.test(locale),
      MESSAGES.periodEnding(locale, { daysLeft: 1, periodEnd: new Date('2026-12-01T12:00:00Z') }),
      MESSAGES.modelDowngraded(locale, { agents: ['A'], model: 'M' }),
      MESSAGES.paymentFailed(locale, { graceUntil: null, invoiceUrl: 'https://x.test/i' }),
    ]);
    texts[0]!.forEach((_, i) => {
      expect(new Set(texts.map((t) => t[i])).size).toBe(LOCALES.length);
    });
  });

  it('paymentFailed inclui o link da fatura', () => {
    expect(
      MESSAGES.paymentFailed('es', { graceUntil: null, invoiceUrl: 'https://x.test/i' }),
    ).toContain('[URL=https://x.test/i]');
  });
});

describe('BB-code e concordância', () => {
  it.each(LOCALES)('preserva [B] e [URL] em %s', (locale) => {
    const text = MESSAGES.paymentFailed(locale, {
      graceUntil: new Date('2026-10-12T13:00:00Z'),
      invoiceUrl: 'https://x.test/i',
    });
    expect(text).toContain('[B]ThinkFlow AI[/B]');
    expect(text).toContain('[URL=https://x.test/i]');
    expect(text).toContain('[/URL]');
    expect(MESSAGES.creditZero(locale)).toContain('[B]ThinkFlow AI[/B]');
  });

  it.each([
    ['pt-BR', '1 dia', '3 dias'],
    ['en', '1 day', '3 days'],
    ['es', '1 día', '3 días'],
  ] as const)('periodEnding singular e plural em %s', (locale, um, tres) => {
    const periodEnd = new Date('2026-12-01T12:00:00Z');
    expect(MESSAGES.periodEnding(locale, { daysLeft: 1, periodEnd })).toContain(um);
    expect(MESSAGES.periodEnding(locale, { daysLeft: 3, periodEnd })).toContain(tres);
  });

  it('data da carência no fuso de São Paulo e no formato do idioma', () => {
    const graceUntil = new Date('2026-10-12T13:00:00Z');
    expect(MESSAGES.paymentFailed('pt-BR', { graceUntil, invoiceUrl: null })).toContain(
      '12/10/2026',
    );
    expect(MESSAGES.paymentFailed('en', { graceUntil, invoiceUrl: null })).toContain('10/12/26');
  });

  it('modelDowngraded concorda com o número de agentes', () => {
    expect(MESSAGES.modelDowngraded('en', { agents: ['A'], model: 'M' })).toContain('It is');
    expect(MESSAGES.modelDowngraded('en', { agents: ['A', 'B'], model: 'M' })).toContain(
      'They are',
    );
  });
});

describe('toLocale', () => {
  it('valor desconhecido cai em pt-BR', () => {
    expect(toLocale('fr')).toBe('pt-BR');
    expect(toLocale(null)).toBe('pt-BR');
    expect(toLocale('en')).toBe('en');
  });
});
