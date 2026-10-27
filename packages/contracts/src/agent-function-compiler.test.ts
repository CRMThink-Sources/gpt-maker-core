import { describe, expect, it } from 'vitest';
import { type FunctionAnswers, validateFunctionAnswers } from './agent-function-answers';
import { type CompileInput, compileAgent, worstCaseBudget } from './agent-function-compiler';
import { sdrFixture } from './agent-functions.fixture';

const KEY = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';

const raw: FunctionAnswers = {
  'empresa.nome': 'CRMThink',
  'empresa.descricao': 'Implantação de Bitrix24.',
  'comum.tom': 'formal',
  'comum.emojis': 'nao',
  'sdr.perguntas': ['Quantos vendedores?', 'Usa CRM hoje?'],
  'sdr.cliente_atual': 'canal',
  'sdr.canal_suporte': 'WhatsApp de suporte',
  'registro.onde': 'conversa',
  'base.produtos': [{ itemKey: KEY, values: { nome: 'Plano Pro', descricao: 'CRM completo' } }],
};

function compile(answers: FunctionAnswers = raw, extra: Partial<CompileInput> = {}) {
  const valid = validateFunctionAnswers(sdrFixture, answers);
  expect(valid.issues).toEqual([]);
  return compileAgent({
    content: sdrFixture,
    answers: valid.answers,
    agentName: 'Ana',
    mode: 'SIMPLE',
    ...extra,
  });
}

describe('compilador da função', () => {
  it('monta o comportamento com campos, listas e trechos', () => {
    const result = compile();
    expect(result.errors).toEqual([]);
    expect(result.behavior).toBe(
      [
        'Você é Ana, da CRMThink. Implantação de Bitrix24.',
        '',
        'PERGUNTAS',
        '- Quantos vendedores?',
        '- Usa CRM hoje?',
        '',
        'CLIENTES ATUAIS',
        'Oriente a falar pelo WhatsApp de suporte.',
        '',
        'REGISTRO',
        'Registre no CRM.',
        '',
        'ESTILO',
        'Use linguagem formal. Não use emojis.',
      ].join('\n'),
    );
  });

  it('é determinístico', () => {
    expect(compile()).toEqual(compile());
  });

  it('inclui só as seções marcadas da múltipla escolha', () => {
    const behavior = compile({ ...raw, 'sdr.cobre': ['demo'] }).behavior;
    expect(behavior).toContain('DEMONSTRAÇÃO\nOfereça uma demonstração.');
    expect(behavior).not.toContain('PREÇO');
  });

  it('aplica os efeitos das escolhas e os dados da empresa', () => {
    const result = compile();
    expect(result.communicationType).toBe('FORMAL');
    expect(result.settings).toEqual({
      enabledHumanTransfer: true,
      limitSubjects: true,
      enabledEmoji: false,
    });
    expect(result.profile).toEqual({
      jobName: 'CRMThink',
      jobDescription: 'Implantação de Bitrix24.',
      jobSite: '',
    });
    expect(result.agentType).toBe('SALE');
  });

  it('gera um treinamento por item da base', () => {
    expect(compile().trainings).toEqual([
      { key: `base.produtos:${KEY}`, text: 'Produto: Plano Pro\nCRM completo' },
    ]);
  });

  it('gera a intenção com as perguntas como campos e só as ações da escolha', () => {
    const [intention] = compile().intentions;
    expect(intention?.key).toBe('qualificacao');
    expect(intention?.input.fields.map((field) => field.name)).toEqual([
      'Pergunta 1',
      'Pergunta 2',
    ]);
    expect(intention?.input.actions).toEqual([
      {
        type: 'TIMELINE_COMMENT',
        config: {
          text: 'Qualificação de {{contact.name}}:\nQuantos vendedores?: {{fields.pergunta_1}}\nUsa CRM hoje?: {{fields.pergunta_2}}',
        },
      },
    ]);
  });

  it('converte funil e etapa da escolha em números e texto', () => {
    const [intention] = compile({
      ...raw,
      'registro.onde': 'funil',
      'registro.funil': { categoryId: 3, stageId: 'C3:NEW' },
    }).intentions;
    expect(intention?.input.actions[0]).toMatchObject({
      type: 'UPSERT_DEAL',
      config: { categoryId: 3, stageId: 'C3:NEW' },
    });
  });

  it('só usa instruções adicionais no modo avançado', () => {
    expect(compile(raw, { additionalInstructions: 'Seja breve.' }).behavior).not.toContain(
      'Seja breve.',
    );
    expect(
      compile(raw, { mode: 'ADVANCED', additionalInstructions: 'Seja breve.' }).behavior,
    ).toMatch(/Seja breve\.$/);
    expect(
      compile(raw, { mode: 'ADVANCED', additionalInstructions: 'x'.repeat(401) }).errors[0],
    ).toContain('instruções adicionais');
  });

  it('usa o comportamento assumido no controle assumido', () => {
    const result = compile(raw, { mode: 'TAKEN_OVER', takenOverBehavior: ' Texto do parceiro ' });
    expect(result.behavior).toBe('Texto do parceiro');
    expect(result.trainings).toHaveLength(1);
  });

  it('falha acima de 3000 caracteres sem truncar', () => {
    const result = compile(raw, { mode: 'TAKEN_OVER', takenOverBehavior: 'y'.repeat(3001) });
    expect(result.behavior).toHaveLength(3001);
    expect(result.errors[0]).toContain('3001 caracteres, 1 acima do limite');
  });

  it('informa a contribuição de cada marcador', () => {
    const { contributions } = compile();
    expect(contributions.markers['empresa.nome']).toBe('CRMThink'.length);
    expect(contributions.markers['sdr.perguntas']).toBe(
      '- Quantos vendedores?\n- Usa CRM hoje?'.length,
    );
    expect(contributions.fixed).toBeGreaterThan(0);
  });
});

describe('orçamento no pior caso', () => {
  it('fica dentro do limite com o template de teste', () => {
    const report = worstCaseBudget(sdrFixture);
    // 100 (nome) + 300 (descrição) + 3 × 120 (perguntas) + 400 (adicionais) + trechos + fixo.
    expect(report.length).toBeLessThanOrEqual(3000);
    expect(report.markers['empresa.descricao']).toBe(300);
    expect(report.markers['sdr.perguntas']).toBe(3 * (2 + 120) + 2);
    expect(report.markers['avancado.instrucoes_adicionais']).toBe(400);
    // Escolhe a opção que rende mais: o canal citado no trecho, no limite.
    expect(report.answers['sdr.cliente_atual']).toBe('canal');
    expect(report.markers['sdr.cliente_atual']).toBe('Oriente a falar pelo .'.length + 100);
  });

  it('passa do limite quando os campos crescem', () => {
    const content = {
      ...sdrFixture,
      fields: sdrFixture.fields.map((field) =>
        field.id === 'sdr.perguntas' && field.kind === 'TEXT_LIST'
          ? { ...field, maxItems: 20, itemMaxLength: 120 }
          : field,
      ),
    };
    const report = worstCaseBudget(content);
    expect(report.length).toBeGreaterThan(3000);
    expect(report.markers['sdr.perguntas']).toBe(20 * 122 + 19);
  });
});
