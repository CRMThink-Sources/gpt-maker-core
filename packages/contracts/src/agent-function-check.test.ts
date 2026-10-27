import { describe, expect, it } from 'vitest';
import { checkTemplate, sampleAnswerSets } from './agent-function-check';
import type { FunctionTemplateContent } from './agent-functions';
import { sdrFixture } from './agent-functions.fixture';

describe('checagem para publicar o template', () => {
  it('template válido não tem erros', () => {
    const check = checkTemplate(sdrFixture);
    expect(check.errors).toEqual([]);
    expect(check.budget.length).toBeLessThanOrEqual(3000);
  });

  it('gera uma variação por opção de cada escolha', () => {
    // Única: comum.tom, comum.emojis, sdr.cliente_atual, registro.onde (+1 cada); múltipla:
    // sdr.cobre (+2, uma por opção). Base + 6.
    expect(sampleAnswerSets(sdrFixture)).toHaveLength(7);
  });

  it('só responde o dependente com a opção dele escolhida', () => {
    const [base, ...variations] = sampleAnswerSets(sdrFixture);
    expect(base!['sdr.canal_suporte']).toBeUndefined();
    expect(variations.find((set) => set['sdr.cliente_atual'] === 'canal')).toHaveProperty(
      'sdr.canal_suporte',
    );
  });

  it('acusa passo que usa dependente sem a condição dele', () => {
    const [intention] = sdrFixture.intentions;
    const content: FunctionTemplateContent = {
      ...sdrFixture,
      intentions: [
        {
          ...intention!,
          actions: [{ ...intention!.actions[1]!, when: undefined }],
        },
      ],
    };
    const check = checkTemplate(content);
    expect(check.issues).toContainEqual({
      where: { section: 'actions', intentionKey: 'qualificacao', actionIndex: 0 },
      message:
        'Registrar qualificação usa "Funil e etapa", que só existe com "Onde registrar" = Em um negócio de um funil: ponha essa condição na ação ou no passo',
    });
    // Com a condição na ação inteira também vale.
    const guarded: FunctionTemplateContent = {
      ...content,
      intentions: [{ ...content.intentions[0]!, when: { field: 'registro.onde', in: ['funil'] } }],
    };
    expect(checkTemplate(guarded).errors).toEqual([]);
  });

  it('acusa ação sem instrução', () => {
    const content: FunctionTemplateContent = {
      ...sdrFixture,
      intentions: [{ ...sdrFixture.intentions[0]!, instructions: null }],
    };
    expect(checkTemplate(content).issues).toContainEqual({
      where: { section: 'actions', intentionKey: 'qualificacao' },
      message: 'Registrar qualificação: escreva a instrução depois da ação',
    });
  });

  it('compila os exemplos mesmo com o pior caso acima do limite', () => {
    const content: FunctionTemplateContent = {
      ...sdrFixture,
      fields: sdrFixture.fields.map((field) =>
        field.id === 'empresa.descricao' && field.kind === 'TEXT'
          ? { ...field, maxLength: 3000 }
          : field,
      ),
      intentions: [
        {
          ...sdrFixture.intentions[0]!,
          actions: [
            ...sdrFixture.intentions[0]!.actions,
            { type: 'CREATE_TASK', config: { title: 'x', responsibleId: 'abc' } },
          ],
        },
      ],
    };
    expect(
      checkTemplate(content).errors.some((error) => error.startsWith('intenção qualificacao')),
    ).toBe(true);
  });

  it('acusa o pior caso acima do limite com a contribuição de cada campo', () => {
    const content: FunctionTemplateContent = {
      ...sdrFixture,
      fields: sdrFixture.fields.map((field) =>
        field.id === 'empresa.descricao' && field.kind === 'TEXT'
          ? { ...field, maxLength: 3000 }
          : field,
      ),
    };
    const [error] = checkTemplate(content).errors;
    expect(error).toMatch(/^pior caso do comportamento com \d+ caracteres \(limite 3000\)/);
    expect(error).toContain('empresa.descricao: 3000');
  });

  it('acusa intenção inválida numa variação de escolha', () => {
    const [intention] = sdrFixture.intentions;
    const content: FunctionTemplateContent = {
      ...sdrFixture,
      intentions: [
        {
          ...intention!,
          // Funil sem etapa: a ação compilada fica inválida só quando a escolha é "funil".
          actions: intention!.actions.map((action) =>
            action.type === 'UPSERT_DEAL'
              ? { ...action, config: { ...action.config, stageId: '' } }
              : action,
          ),
        },
      ],
    };
    const { errors } = checkTemplate(content);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^intenção qualificacao: actions\.0\.config\.stageId/);
  });
});
