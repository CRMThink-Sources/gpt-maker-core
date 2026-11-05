import { describe, expect, it } from 'vitest';
import { validateFunctionAnswers } from './agent-function-answers';
import { checkTemplate } from './agent-function-check';
import { compileAgent, worstCaseBudget } from './agent-function-compiler';
import {
  type FunctionIntention,
  functionTemplateContentSchema,
  functionTemplateErrors,
  type FunctionTemplateContentInput,
} from './agent-functions';
import { sdrFixtureInput } from './agent-functions.fixture';

/** Cópia sem uma chave. */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

/** Item de SPA com campos ligados pelo cliente (change agent-function-spa-item). */
const action = {
  type: 'CREATE_SPA_ITEM',
  config: {
    spa: '{{suporte.spa}}',
    title: 'Chamado: {{fields.problema}}',
    values: {
      origem: 'CHAT',
      prioridade: '{{fields.prioridade}}',
      problema: '{{fields.problema}}',
      chat: '{{dialog.chatId}}',
      dialogo: '{{dialog.id}}',
      sessao: '{{dialog.sessionId}}',
    },
  },
};

const abrirChamado: FunctionIntention = {
  key: 'abrir_chamado',
  name: 'Abrir chamado',
  whenToUse: 'Quando a base não resolver o problema.',
  fields: [
    { name: 'Problema', description: 'O problema relatado.', type: 'STRING', required: true },
    {
      name: 'Prioridade',
      description: 'Uma de: LOW, NORMAL, HIGH, URGENT. URGENT: {{suporte.urgente}}',
      type: 'STRING',
      required: true,
    },
  ],
  actions: [action],
  instructions: 'Confirme que o chamado foi aberto.',
};

const input: FunctionTemplateContentInput = {
  ...sdrFixtureInput,
  fields: [
    ...sdrFixtureInput.fields,
    {
      kind: 'TEXT',
      id: 'suporte.urgente',
      label: 'Quando é urgente',
      required: true,
      maxLength: 150,
    },
    {
      kind: 'BITRIX_SPA',
      id: 'suporte.spa',
      label: 'Onde abrir o chamado',
      required: true,
      values: [
        { id: 'origem', label: 'Origem', required: true },
        {
          id: 'prioridade',
          label: 'Prioridade',
          required: true,
          options: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
        },
        { id: 'problema', label: 'Problema relatado', required: true },
        { id: 'chat', label: 'Chat de origem', required: false },
        { id: 'dialogo', label: 'Diálogo de origem', required: false },
        { id: 'sessao', label: 'Sessão de Linhas Abertas', required: false },
      ],
    },
  ],
  intentions: [...(sdrFixtureInput.intentions ?? []), abrirChamado],
};
const content = functionTemplateContentSchema.parse(input);

const base = {
  'empresa.nome': 'CRMThink',
  'empresa.descricao': 'Implantação de Bitrix24.',
  'comum.tom': 'formal',
  'comum.emojis': 'nao',
  'sdr.perguntas': ['Quantos vendedores?'],
  'sdr.cliente_atual': 'transferir',
  'registro.onde': 'conversa',
  'suporte.urgente': 'Sistema parado.',
};

const spa = {
  entityTypeId: 1204,
  categoryId: 180,
  stageId: 'DT1204_180:NEW',
  fields: {
    origem: 'ufCrm136_1',
    prioridade: 'ufCrm136_2',
    problema: 'ufCrm136_3',
    chat: 'ufCrm136_4',
    dialogo: 'ufCrm136_5',
  },
  lists: { prioridade: { LOW: 101, HIGH: 103, OUTRA: 999 } },
};

const withAction = (config: Record<string, unknown>) =>
  functionTemplateErrors(
    functionTemplateContentSchema.parse({
      ...input,
      intentions: [
        ...(sdrFixtureInput.intentions ?? []),
        { ...abrirChamado, actions: [{ ...action, config: { ...action.config, ...config } }] },
      ],
    }),
  );

describe('campo de SPA no template', () => {
  it('template completo não tem erros', () => {
    expect(checkTemplate(content).errors).toEqual([]);
  });

  it('valores com o mesmo id e opções repetidas', () => {
    const field = (values: unknown) =>
      functionTemplateContentSchema.safeParse({
        ...input,
        fields: [
          ...sdrFixtureInput.fields,
          { kind: 'BITRIX_SPA', id: 'suporte.spa', label: 'SPA', required: true, values },
        ],
      }).success;
    expect(
      field([
        { id: 'a', label: 'A', required: true },
        { id: 'a', label: 'B', required: true },
      ]),
    ).toBe(false);
    expect(field([{ id: 'a', label: 'A', required: true, options: ['X', 'X'] }])).toBe(false);
  });

  it('spa precisa ser um campo de SPA', () => {
    expect(withAction({ spa: '{{empresa.nome}}' })).toContain(
      'Abrir chamado: em "spa", escolha um campo de processo inteligente',
    );
  });

  it('valor não declarado e valor declarado sem uso', () => {
    const values = omit(action.config.values, 'sessao');
    expect(withAction({ values: { ...values, canal: 'x' } })).toEqual(
      expect.arrayContaining([
        'Abrir chamado: "canal" não é um valor de suporte.spa',
        'valor sem uso em suporte.spa: sessao (preencha em "values" de uma ação "Criar item de SPA")',
      ]),
    );
  });

  it('título obrigatório', () => {
    expect(withAction({ title: '' })).toContain('Abrir chamado: escreva o título do item de SPA');
  });

  it('o campo de SPA não entra em textos', () => {
    const errors = functionTemplateErrors({
      ...content,
      behavior: `${content.behavior}\n{{suporte.spa}}`,
    });
    expect(errors).toContain(
      'o campo de SPA {{suporte.spa}} só pode ser usado em "spa" da ação "Criar item de SPA"',
    );
  });

  it('não pesa no orçamento', () => {
    expect(worstCaseBudget(content).markers['suporte.spa']).toBeUndefined();
  });
});

describe('respostas do campo de SPA', () => {
  it('normaliza: descarta valores e opções desconhecidos', () => {
    const { answers, issues } = validateFunctionAnswers(content, {
      ...base,
      'suporte.spa': { ...spa, fields: { ...spa.fields, extra: 'ufCrm136_9' } },
    });
    expect(issues).toEqual([]);
    expect(answers['suporte.spa']).toEqual({
      ...spa,
      lists: { prioridade: { LOW: 101, HIGH: 103 } },
    });
  });

  it('valor obrigatório sem campo, SPA obrigatório e rascunho', () => {
    const fields = omit(spa.fields, 'origem');
    expect(
      validateFunctionAnswers(content, { ...base, 'suporte.spa': { ...spa, fields } }).issues,
    ).toEqual([{ field: 'suporte.spa.origem', message: 'escolha o campo do SPA para "Origem"' }]);
    expect(validateFunctionAnswers(content, base).issues).toEqual([
      { field: 'suporte.spa', message: 'campo obrigatório' },
    ]);
    expect(
      validateFunctionAnswers(
        content,
        { ...base, 'suporte.spa': { ...spa, fields } },
        { partial: true },
      ).issues,
    ).toEqual([]);
  });

  it('código de campo inválido', () => {
    expect(
      validateFunctionAnswers(content, {
        ...base,
        'suporte.spa': { ...spa, fields: { ...spa.fields, origem: 'uf crm' } },
      }).issues,
    ).toEqual([{ field: 'suporte.spa', message: 'escolha o processo inteligente' }]);
  });
});

describe('compilação da ação de SPA', () => {
  it('troca valores pelos códigos do portal e omite valor sem campo', () => {
    const valid = validateFunctionAnswers(content, { ...base, 'suporte.spa': spa });
    expect(valid.issues).toEqual([]);
    const compiled = compileAgent({
      content,
      answers: valid.answers,
      agentName: 'Ana',
      mode: 'SIMPLE',
    });
    expect(compiled.errors).toEqual([]);
    const intention = compiled.intentions.find((item) => item.key === 'abrir_chamado')!;
    expect(intention.input.actions).toEqual([
      {
        type: 'CREATE_SPA_ITEM',
        config: {
          entityTypeId: 1204,
          categoryId: 180,
          stageId: 'DT1204_180:NEW',
          title: 'Chamado: {{fields.problema}}',
          fields: {
            ufCrm136_1: 'CHAT',
            ufCrm136_2: '{{fields.prioridade}}',
            ufCrm136_3: '{{fields.problema}}',
            ufCrm136_4: '{{dialog.chatId}}',
            ufCrm136_5: '{{dialog.id}}',
          },
          lists: { ufCrm136_2: { LOW: 101, HIGH: 103 } },
        },
      },
    ]);
    expect(intention.input.fields[1]!.description).toBe(
      'Uma de: LOW, NORMAL, HIGH, URGENT. URGENT: Sistema parado.',
    );
  });
});

describe('limite do GPTMaker na descrição de campo coletado', () => {
  it('a checagem acusa a descrição que só passa de 255 com as respostas no limite', () => {
    const long = functionTemplateContentSchema.parse({
      ...input,
      fields: content.fields.map((field) =>
        field.id === 'suporte.urgente' && field.kind === 'TEXT'
          ? { ...field, maxLength: 250 }
          : field,
      ),
    });
    expect(checkTemplate(long).errors).toEqual([
      'intenção abrir_chamado: fields.1.description use até 255 caracteres na descrição (limite do GPTMaker) (com as respostas no limite)',
    ]);
    // Com as respostas de exemplo, cabe: o problema só aparece no limite.
    expect(checkTemplate(content).errors).toEqual([]);
  });
});
