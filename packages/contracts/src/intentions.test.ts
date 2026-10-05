import { describe, expect, it } from 'vitest';
import {
  type IntentionInput,
  intentionInputSchema,
  intentionJsonName,
  intentionPlaceholders,
} from './intentions';
import { createTriggerSchema } from './triggers';

const base: IntentionInput = {
  name: 'Consultar pedido',
  whenToUse: 'Quando o cliente perguntar pelo pedido',
  fields: [{ name: 'Número do pedido', description: 'Número', type: 'NUMBER', required: true }],
  httpMethod: 'GET',
  url: 'https://loja.com/pedidos/{{numero_do_pedido}}',
  headers: [],
  params: [],
  body: null,
  autoGenerateParams: false,
  autoGenerateBody: false,
  responseMode: 'API',
  instructions: null,
  active: true,
};

const messages = (input: IntentionInput) => {
  const result = intentionInputSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('intenções: validação', () => {
  it('nome JSON do campo e campos citados', () => {
    expect(intentionJsonName('Número do pedido')).toBe('numero_do_pedido');
    expect(intentionJsonName('  E-mail! ')).toBe('e_mail');
    expect(intentionPlaceholders('/a/{{x}}/{{ y }}/{{x}}')).toEqual(['x', 'y']);
  });

  it('válida com o campo citado na URL', () => {
    expect(messages(base)).toEqual([]);
  });

  it('campo citado sem cadastro, em qualquer lugar', () => {
    expect(
      messages({
        ...base,
        url: 'https://loja.com/{{cpf}}',
        params: [{ name: 'q', value: '{{nome}}' }],
        headers: [{ name: 'X', value: '{{token}}' }],
      }),
    ).toEqual([
      'url: Campo não cadastrado: {{cpf}}',
      'params.0.value: Campo não cadastrado: {{nome}}',
      'headers.0.value: Campo não cadastrado: {{token}}',
    ]);
  });

  it('URL, corpo JSON, instrução e nomes de campo repetidos', () => {
    expect(messages({ ...base, url: 'ftp://loja.com/{{numero_do_pedido}}' })).toEqual([
      'url: Informe uma URL http ou https',
    ]);
    expect(
      messages({ ...base, httpMethod: 'POST', body: '{"pedido": {{numero_do_pedido}}}' }),
    ).toEqual([]);
    expect(messages({ ...base, httpMethod: 'POST', body: '{pedido' })).toEqual([
      'body: O corpo precisa ser um JSON válido',
    ]);
    expect(messages({ ...base, responseMode: 'INSTRUCTIONS', instructions: ' ' })).toEqual([
      'instructions: Escreva a instrução de resposta',
    ]);
    expect(
      messages({
        ...base,
        fields: [...base.fields, { ...base.fields[0]!, name: 'numero do pedido' }],
      }),
    ).toEqual(['fields.1.name: Já existe um campo com esse nome']);
  });

  it('intenção Bitrix: ações obrigatórias, campos citados conferidos, sem URL', () => {
    const bitrix: IntentionInput = {
      ...base,
      kind: 'BITRIX',
      url: '',
      actions: [
        {
          type: 'CREATE_LEAD',
          config: {
            fields: { TITLE: 'Pedido {{fields.numero_do_pedido}}', NAME: '{{contact.name}}' },
          },
        },
      ],
    };
    expect(messages(bitrix)).toEqual([]);
    expect(messages({ ...bitrix, actions: [] })).toEqual(['actions: Inclua ao menos uma ação']);
    expect(
      messages({
        ...bitrix,
        actions: [{ type: 'TIMELINE_COMMENT', config: { text: 'CPF {{fields.cpf}}' } }],
      }),
    ).toEqual(['actions.0: Campo não cadastrado: {{fields.cpf}}']);
    // Webhook de saída não é ação de intenção.
    expect(
      messages({
        ...bitrix,
        actions: [{ type: 'OUTBOUND_WEBHOOK', config: { url: 'https://x.com' } } as never],
      }).length,
    ).toBeGreaterThan(0);
  });

  it('transferência para atendente: operador livre ou usuário escolhido', () => {
    const bitrix = { ...base, kind: 'BITRIX' as const, url: '' };
    expect(
      messages({
        ...bitrix,
        actions: [{ type: 'TRANSFER_TO_HUMAN', config: { target: 'OPERATOR' } }],
      }),
    ).toEqual([]);
    expect(
      messages({ ...bitrix, actions: [{ type: 'TRANSFER_TO_HUMAN', config: { target: 'USER' } }] }),
    ).toEqual(['actions.0.config.userId: escolha o usuário que recebe a conversa']);
  });

  it('gatilho continua recusando {{fields.x}}', () => {
    const result = createTriggerSchema.safeParse({
      name: 'g',
      event: 'onNewMessage',
      actions: [{ type: 'TIMELINE_COMMENT', config: { text: '{{fields.cpf}}' } }],
    });
    expect(result.success).toBe(false);
  });
});
