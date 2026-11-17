import {
  type FunctionAnswers,
  functionTemplateContentSchema,
  type HallucinationSuggestion,
} from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { createT } from '@/i18n';
import {
  analysisCost,
  analysisPath,
  applySuggestion,
  buildRequest,
  conversationMessagesPath,
  conversationsPath,
  flaggable,
  readOnlyReasonKey,
  suggestionApplicable,
  toggleFlag,
} from './hallucination-logic';

const form = functionTemplateContentSchema.parse({
  agentType: 'SUPPORT',
  profile: {},
  behavior: 'Atenda com cordialidade.',
  fields: [
    {
      kind: 'KNOWLEDGE',
      id: 'base.politicas',
      label: 'Políticas',
      required: false,
      maxItems: 2,
      subfields: [
        { id: 'titulo', label: 'Título', required: true, maxLength: 40 },
        { id: 'texto', label: 'Texto', required: true, maxLength: 80 },
      ],
      format: '{{titulo}}: {{texto}}',
    },
  ],
});
const KEY = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';
const NEW_KEY = '1b9e4d2c-8f3a-4e5b-a6c7-d8e9f0a1b2c3';
const answers: FunctionAnswers = {
  'base.politicas': [{ itemKey: KEY, values: { titulo: 'Pagamento', texto: 'Só cartão.' } }],
};
const t = createT('pt-BR', 'hallucination');

const add = (item: Record<string, string>, applicable = true): HallucinationSuggestion => ({
  kind: 'ADD_ITEM',
  fieldId: 'base.politicas',
  item,
  applicable,
});
const replace = (values: Record<string, string>, index = 0): HallucinationSuggestion => ({
  kind: 'REPLACE_TEXT',
  fieldId: 'base.politicas',
  index,
  values,
  applicable: true,
});

describe('respostas marcáveis', () => {
  it('só resposta do agente com texto', () => {
    expect(flaggable({ role: 'AGENT', text: 'oi' })).toBe(true);
    expect(flaggable({ role: 'AGENT', text: '   ' })).toBe(false);
    expect(flaggable({ role: 'CUSTOMER', text: 'oi' })).toBe(false);
    expect(flaggable({ role: 'OTHER', text: 'oi' })).toBe(false);
  });

  it('marca e desmarca', () => {
    expect(toggleFlag([], 'a')).toEqual(['a']);
    expect(toggleFlag(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleFlag(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('passando de 50 marcações, a nova não entra, mas dá para desmarcar', () => {
    const full = Array.from({ length: 50 }, (_, i) => `m${i}`);
    expect(toggleFlag(full, 'novo')).toEqual(full);
    expect(toggleFlag(full, 'm0')).toHaveLength(49);
  });
});

describe('pedido', () => {
  const base = {
    analysisId: 'a1',
    source: 'REAL' as const,
    conversationId: 'chat',
    flagged: ['m1'],
    answers,
  };

  it('leva a nota sem espaços nas pontas', () => {
    expect(buildRequest({ ...base, note: '  prazo errado  ' })).toMatchObject({
      note: 'prazo errado',
      flaggedMessageIds: ['m1'],
      source: 'REAL',
    });
  });

  it('nota vazia ou só espaços não vai', () => {
    expect('note' in buildRequest({ ...base, note: '   ' })).toBe(false);
    expect('note' in buildRequest({ ...base, note: '' })).toBe(false);
  });

  it('copia as marcações (não guarda a lista da tela)', () => {
    const flagged = ['m1'];
    const request = buildRequest({ ...base, flagged, note: '' });
    flagged.push('m2');
    expect(request.flaggedMessageIds).toEqual(['m1']);
  });
});

describe('custo', () => {
  it('chave do cliente: sem créditos', () => {
    expect(analysisCost(3, true, t)).toEqual({ credits: 0, label: 'sem uso de créditos' });
  });

  it('chave da CRMThink: o preço da análise, no singular e no plural', () => {
    expect(analysisCost(3, false, t)).toEqual({ credits: 3, label: '3 créditos' });
    expect(analysisCost(1, false, t)).toEqual({ credits: 1, label: '1 crédito' });
  });
});

describe('aplicar sugestão', () => {
  it('item novo cabe no fim da base', () => {
    const next = applySuggestion(
      form,
      answers,
      add({ titulo: 'Prazo', texto: 'Em [preencher: dias]' }),
      NEW_KEY,
    );
    expect(next?.['base.politicas']).toEqual([
      { itemKey: KEY, values: { titulo: 'Pagamento', texto: 'Só cartão.' } },
      { itemKey: NEW_KEY, values: { titulo: 'Prazo', texto: 'Em [preencher: dias]' } },
    ]);
    // Não mexe nas respostas originais.
    expect(answers['base.politicas']).toHaveLength(1);
  });

  it('troca o texto de um item existente e preserva o resto do item', () => {
    const next = applySuggestion(form, answers, replace({ texto: 'Cartão e boleto.' }), NEW_KEY);
    expect(next?.['base.politicas']).toEqual([
      { itemKey: KEY, values: { titulo: 'Pagamento', texto: 'Cartão e boleto.' } },
    ]);
  });

  it('sugestão que o servidor marcou só leitura nunca aplica', () => {
    const readOnly = add({ titulo: 'Prazo', texto: 'x' }, false);
    expect(suggestionApplicable(form, answers, readOnly)).toBe(false);
    expect(applySuggestion(form, answers, readOnly, NEW_KEY)).toBeNull();
  });

  it('campo cheio: item novo não cabe', () => {
    const full: FunctionAnswers = {
      'base.politicas': [
        { itemKey: KEY, values: { titulo: 'A', texto: 'a' } },
        { itemKey: NEW_KEY, values: { titulo: 'B', texto: 'b' } },
      ],
    };
    expect(suggestionApplicable(form, full, add({ titulo: 'C', texto: 'c' }))).toBe(false);
  });

  it('o formulário mudou: o item a trocar já não existe', () => {
    expect(suggestionApplicable(form, {}, replace({ texto: 'x' }))).toBe(false);
    expect(applySuggestion(form, {}, replace({ texto: 'x' }), NEW_KEY)).toBeNull();
  });

  it('texto acima do limite do campo não aplica', () => {
    expect(suggestionApplicable(form, answers, replace({ texto: 'a'.repeat(81) }))).toBe(false);
  });

  it('campo inexistente não aplica', () => {
    expect(
      suggestionApplicable(form, answers, {
        ...add({ titulo: 'x', texto: 'y' }),
        fieldId: 'nao.existe',
      }),
    ).toBe(false);
  });
});

describe('motivo de só leitura', () => {
  it('usa o motivo do servidor, ou o genérico', () => {
    expect(readOnlyReasonKey({ ...add({}, false), reason: 'FULL' })).toBe('readOnly.FULL');
    expect(readOnlyReasonKey(add({}, false))).toBe('readOnly.GENERIC');
  });
});

describe('rotas', () => {
  it('codifica o id da conversa e leva origem e cursor', () => {
    expect(conversationsPath('ag 1', 'REAL', 40)).toBe(
      '/app/agents/ag%201/conversations?source=REAL&cursor=40',
    );
    expect(conversationMessagesPath('ag1', 'REAL', 'public-api-a-t:chat/1')).toBe(
      '/app/agents/ag1/conversations/public-api-a-t%3Achat%2F1/messages?source=REAL',
    );
    expect(analysisPath('ag1')).toBe('/app/agents/ag1/function/hallucination');
  });
});
