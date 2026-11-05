import { describe, expect, it } from 'vitest';
import {
  dialogChatId,
  renderFields,
  renderTemplate,
  type TemplateContext,
  templateErrors,
  templatesUse,
} from './templates';
import { createTriggerSchema } from './triggers';

const context: TemplateContext = {
  contact: { name: 'Maria', phone: null },
  message: { text: 'Quero um orçamento', role: 'user' },
  agent: { id: 'a1', name: 'Ana' },
  event: { name: 'onNewMessage', date: '2026-10-01T17:26:53.388Z' },
  dialog: { id: 'chat9498' },
  interaction: { id: null, protocol: null },
  payload: { channel: 'API', images: [], extra: { nested: 'x' }, count: 3 },
};

describe('templates dos gatilhos', () => {
  it.each([
    ['Lead de {{contact.name}}', 'Lead de Maria'],
    ['{{ contact.name }} disse: {{message.text}}', 'Maria disse: Quero um orçamento'],
    ['Tel: {{contact.phone}}', 'Tel: '],
    ['Tel: {{contact.phone | "sem telefone"}}', 'Tel: sem telefone'],
    ["Tel: {{contact.phone | 'n/d'}}", 'Tel: n/d'],
    ['{{contact.name | "anônimo"}}', 'Maria'],
    ['Canal {{payload.channel}} ({{payload.extra.nested}})', 'Canal API (x)'],
    ['{{payload.count}} itens, {{payload.images}}', '3 itens, []'],
    ['{{payload.nao.existe}}', ''],
    ['sem variáveis', 'sem variáveis'],
  ])('%s', (template, expected) => {
    expect(renderTemplate(template, context)).toBe(expected);
  });

  it('mapa de campos', () => {
    expect(renderFields({ TITLE: 'Lead {{contact.name}}', SOURCE_ID: 'WEB' }, context)).toEqual({
      TITLE: 'Lead Maria',
      SOURCE_ID: 'WEB',
    });
  });

  it.each([
    ['Lead de {{contact.name}}', []],
    ['{{payload.qualquer.campo}}', []],
    ['{{contact.phone | "x"}}', []],
    ['{{contact.email}}', ['variável desconhecida: {{contact.email}}']],
    ['{{cliente.nome}}', ['variável desconhecida: {{cliente.nome}}']],
    ['{{payload}}', ['variável desconhecida: {{payload}}']],
    ['{{contact name}}', ['variável inválida: {{contact name}}']],
    ['Olá {{contact.name', ['chaves {{ }} sem par']],
  ])('validação: %s', (template, errors) => {
    expect(templateErrors(template)).toEqual(errors);
  });

  it('o cadastro de gatilhos recusa template inválido', () => {
    const result = createTriggerSchema.safeParse({
      name: 'g',
      event: 'onNewMessage',
      actions: [{ type: 'TIMELINE_COMMENT', config: { text: 'Oi {{cliente.nome}}' } }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('variável desconhecida: {{cliente.nome}}');
  });
});

describe('chat e sessão da Linha Aberta', () => {
  it('variáveis aceitas e vazias sem valor', () => {
    expect(templateErrors('{{dialog.chatId}} {{dialog.sessionId}}')).toEqual([]);
    expect(renderTemplate('[{{dialog.chatId}}|{{dialog.sessionId}}]', context)).toBe('[|]');
    expect(
      renderTemplate('{{dialog.id}} {{dialog.chatId}} {{dialog.sessionId}}', {
        ...context,
        dialog: { id: 'chat9500', chatId: '9500', sessionId: '2008' },
      }),
    ).toBe('chat9500 9500 2008');
  });

  it('número do chat', () => {
    expect(dialogChatId('chat9498')).toBe('9498');
    expect(dialogChatId('test:abc')).toBeNull();
    expect(dialogChatId(null)).toBeNull();
  });

  it('templates que citam a sessão', () => {
    expect(templatesUse(['a', 'sessão {{ dialog.sessionId }}'], 'dialog.sessionId')).toBe(true);
    expect(templatesUse(['{{dialog.id}}'], 'dialog.sessionId')).toBe(false);
  });
});
