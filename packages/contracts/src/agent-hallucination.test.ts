import { describe, expect, it } from 'vitest';
import {
  HALLUCINATION_NOTE_MAX,
  hallucinationModelOutputSchema,
  hallucinationRequestSchema,
} from './agent-hallucination';
import { CONVERSATION_MAX_MESSAGES, listConversationsQuerySchema } from './agent-conversations';

const ANALYSIS = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const base = { analysisId: ANALYSIS, source: 'TEST', conversationId: 'c1', answers: {} };

describe('pedido de análise', () => {
  it('aceita o pedido mínimo, sem marcação nem nota', () => {
    const parsed = hallucinationRequestSchema.parse(base);
    expect(parsed.flaggedMessageIds).toEqual([]);
    expect(parsed.note).toBeUndefined();
  });

  it('nota de 500 caracteres passa e de 501 não', () => {
    expect(
      hallucinationRequestSchema.safeParse({ ...base, note: 'a'.repeat(HALLUCINATION_NOTE_MAX) })
        .success,
    ).toBe(true);
    expect(
      hallucinationRequestSchema.safeParse({
        ...base,
        note: 'a'.repeat(HALLUCINATION_NOTE_MAX + 1),
      }).success,
    ).toBe(false);
  });

  it.each([
    ['analysisId que não é UUID', { analysisId: 'x' }],
    ['origem desconhecida', { source: 'OUTRA' }],
    ['conversa vazia', { conversationId: '' }],
    ['51 marcações', { flaggedMessageIds: Array.from({ length: 51 }, (_, i) => `m${i}`) }],
  ])('recusa %s', (_nome, extra) => {
    expect(hallucinationRequestSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });
});

describe('saída da IA', () => {
  const finding = {
    messageRef: 'm3',
    claim: 'Entregamos em 5 dias',
    verdict: 'UNSUPPORTED',
    reason: 'Nada na base fala de prazo',
  };

  it('aceita sem causa, sem origem e sem sugestão', () => {
    expect(hallucinationModelOutputSchema.safeParse({ findings: [finding] }).success).toBe(true);
  });

  it('lista ausente vira vazia', () => {
    expect(hallucinationModelOutputSchema.parse({}).findings).toEqual([]);
  });

  it('aceita sugestão de item novo e de troca de texto', () => {
    const add = {
      ...finding,
      cause: 'MISSING_IN_BASE',
      suggestion: { kind: 'ADD_ITEM', fieldId: 'base', item: { titulo: 'Prazo', texto: 'x' } },
    };
    const replace = {
      ...finding,
      cause: 'CONFLICTING_BASE',
      source: { fieldId: 'base', index: 2 },
      suggestion: { kind: 'REPLACE_TEXT', fieldId: 'base', index: 2, values: { texto: 'y' } },
    };
    expect(hallucinationModelOutputSchema.safeParse({ findings: [add, replace] }).success).toBe(
      true,
    );
  });

  it.each([
    ['veredito inventado', { verdict: 'TALVEZ' }],
    ['causa inventada', { cause: 'AZAR' }],
    ['sugestão de outro tipo', { suggestion: { kind: 'DELETE', fieldId: 'f' } }],
    ['troca sem posição', { suggestion: { kind: 'REPLACE_TEXT', fieldId: 'f', values: {} } }],
    ['motivo vazio', { reason: '   ' }],
  ])('recusa %s', (_nome, extra) => {
    expect(
      hallucinationModelOutputSchema.safeParse({ findings: [{ ...finding, ...extra }] }).success,
    ).toBe(false);
  });
});

describe('listagem de conversas', () => {
  it('cursor começa em 0 e aceita número em texto (query string)', () => {
    expect(listConversationsQuerySchema.parse({ source: 'REAL' }).cursor).toBe(0);
    expect(listConversationsQuerySchema.parse({ source: 'TEST', cursor: '40' }).cursor).toBe(40);
  });

  it.each([
    [{ source: 'X' }],
    [{ source: 'REAL', cursor: '-1' }],
    [{ source: 'REAL', cursor: 'a' }],
  ])('recusa %j', (query) => {
    expect(listConversationsQuerySchema.safeParse(query).success).toBe(false);
  });

  it('limite de mensagens da análise é 50', () => {
    expect(CONVERSATION_MAX_MESSAGES).toBe(50);
  });
});
