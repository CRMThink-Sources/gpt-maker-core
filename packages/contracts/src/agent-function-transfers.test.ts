import { describe, expect, it } from 'vitest';
import { validateFunctionAnswers } from './agent-function-answers';
import { checkTemplate, sampleAnswerSets } from './agent-function-check';
import { compileAgent, worstCaseBudget } from './agent-function-compiler';
import { transferHash } from './agent-function-plan';
import {
  functionTemplateContentSchema,
  functionTemplateErrors,
  type FunctionTemplateContentInput,
} from './agent-functions';
import { sdrFixture, sdrFixtureInput } from './agent-functions.fixture';

/** Vários usuários, canal aberto e transferência entre agentes (design D15–D17). */
const AGENT_B = '0b6f7a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

const input: FunctionTemplateContentInput = {
  ...sdrFixtureInput,
  fields: [
    ...sdrFixtureInput.fields,
    {
      kind: 'BITRIX_USER',
      id: 'sdr.vendedores',
      label: 'Vendedores',
      required: true,
      multiple: true,
    },
    { kind: 'BITRIX_OPENLINE', id: 'sdr.canal', label: 'Canal aberto', required: false },
    {
      kind: 'CHOICE',
      id: 'sdr.orcamento',
      label: 'Pedido de orçamento',
      required: true,
      options: [
        { value: 'aqui', label: 'Atender aqui', snippet: 'Atenda o orçamento.' },
        {
          value: 'agente',
          label: 'Passar para outro agente',
          snippet: 'Orçamentos vão para outro agente.',
          dependents: [{ kind: 'AGENT', id: 'sdr.agente', label: 'Agente', required: true }],
        },
      ],
    },
  ],
  behavior: `${sdrFixtureInput.behavior}\n{{sdr.orcamento}}`,
  intentions: [
    ...(sdrFixtureInput.intentions ?? []),
    {
      key: 'passar_vendedor',
      name: 'Passar para vendedor',
      whenToUse: 'Quando o cliente quiser comprar.',
      actions: [
        { type: 'TRANSFER_TO_HUMAN', config: { target: 'USER', userId: '{{sdr.vendedores}}' } },
      ],
      instructions: 'Avise que um vendedor vai continuar.',
    },
  ],
  transfers: [
    {
      key: 'orcamento',
      when: { field: 'sdr.orcamento', in: ['agente'] },
      agent: '{{sdr.agente}}',
      instructions: 'Quando o cliente pedir orçamento ({{empresa.nome}}).',
      returnOnFinish: true,
    },
  ],
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
  'sdr.vendedores': [3, 5],
};

describe('respostas', () => {
  it('usuários: lista de 1 a 20 sem repetir', () => {
    expect(validateFunctionAnswers(content, { ...base, 'sdr.orcamento': 'aqui' }).issues).toEqual(
      [],
    );
    const repeated = validateFunctionAnswers(content, {
      ...base,
      'sdr.orcamento': 'aqui',
      'sdr.vendedores': [3, 3],
    });
    expect(repeated.issues).toContainEqual({
      field: 'sdr.vendedores',
      message: 'usuário repetido',
    });
    const empty = validateFunctionAnswers(content, {
      ...base,
      'sdr.orcamento': 'aqui',
      'sdr.vendedores': [],
    });
    expect(empty.issues).toContainEqual({ field: 'sdr.vendedores', message: 'campo obrigatório' });
  });

  it('canal aberto e agente', () => {
    const { issues } = validateFunctionAnswers(content, {
      ...base,
      'sdr.canal': 'x' as never,
      'sdr.orcamento': 'agente',
      'sdr.agente': 'nao-e-uuid',
    });
    expect(issues).toEqual([
      { field: 'sdr.canal', message: 'escolha um canal aberto' },
      { field: 'sdr.agente', message: 'escolha um agente' },
    ]);
  });
});

describe('checagem das transferências', () => {
  it('template com transferência válida não tem erros', () => {
    expect(checkTemplate(content).errors).toEqual([]);
  });

  it('agent precisa citar sozinho um campo de agente', () => {
    const errors = functionTemplateErrors({
      ...content,
      transfers: [{ ...content.transfers[0]!, agent: '{{empresa.nome}}' }],
    });
    expect(errors).toContain('transferência orcamento: escolha um campo de agente');
  });

  it('transferência repetida, condição inválida e marcador sem campo', () => {
    const transfer = content.transfers[0]!;
    const errors = functionTemplateErrors({
      ...content,
      transfers: [
        transfer,
        { ...transfer, when: { field: 'empresa.nome', in: ['x'] }, instructions: '{{sdr.nada}}' },
      ],
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        'transferência repetida: orcamento',
        'condição da transferência orcamento cita campo que não é escolha: empresa.nome',
        'marcador sem campo em transferência orcamento: {{sdr.nada}}',
      ]),
    );
  });

  it('dependente usado só na transferência precisa da condição dela', () => {
    const errors = functionTemplateErrors({
      ...content,
      transfers: [{ ...content.transfers[0]!, when: undefined }],
    });
    expect(errors.some((message) => message.includes('"Agente"'))).toBe(true);
  });

  it('exemplos dão lista, canal e agente', () => {
    const sets = sampleAnswerSets(content);
    expect(sets[0]!['sdr.vendedores']).toEqual([1]);
    expect(sets[0]!['sdr.canal']).toBe(1);
    expect(sets.find((set) => set['sdr.orcamento'] === 'agente')!['sdr.agente']).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});

describe('compilação', () => {
  const compile = (answers: Record<string, unknown>) => {
    const valid = validateFunctionAnswers(content, answers as never);
    expect(valid.issues).toEqual([]);
    return compileAgent({ content, answers: valid.answers, agentName: 'Ana', mode: 'SIMPLE' });
  };

  it('campo de vários usuários vira lista no userId', () => {
    const compiled = compile({ ...base, 'sdr.orcamento': 'aqui' });
    expect(compiled.errors).toEqual([]);
    const intention = compiled.intentions.find((item) => item.key === 'passar_vendedor')!;
    expect(intention.input.actions[0]!.config).toMatchObject({ target: 'USER', userId: [3, 5] });
  });

  it('transferências só com a condição atendida', () => {
    expect(compile({ ...base, 'sdr.orcamento': 'aqui' }).transfers).toEqual([]);
    const compiled = compile({ ...base, 'sdr.orcamento': 'agente', 'sdr.agente': AGENT_B });
    expect(compiled.transfers).toEqual([
      {
        key: 'orcamento',
        agentId: AGENT_B,
        fieldId: 'sdr.agente',
        instructions: 'Quando o cliente pedir orçamento (CRMThink).',
        returnOnFinish: true,
      },
    ]);
    expect(transferHash(compiled.transfers[0]!)).toMatch(/^[0-9a-f]+$/);
  });

  it('template sem transferências compila como antes', () => {
    const answers = validateFunctionAnswers(sdrFixture, {
      'empresa.nome': 'CRMThink',
      'empresa.descricao': 'Implantação de Bitrix24.',
      'comum.tom': 'formal',
      'comum.emojis': 'nao',
      'sdr.perguntas': ['Quantos vendedores?'],
      'sdr.cliente_atual': 'transferir',
      'registro.onde': 'conversa',
    }).answers;
    const compiled = compileAgent({
      content: sdrFixture,
      answers,
      agentName: 'Ana',
      mode: 'SIMPLE',
    });
    expect(compiled.errors).toEqual([]);
    expect(compiled.transfers).toEqual([]);
  });

  it('pior caso não conta agente nem canal e cabe no limite', () => {
    const budget = worstCaseBudget(content);
    expect(budget.length).toBeLessThanOrEqual(3000);
  });
});
