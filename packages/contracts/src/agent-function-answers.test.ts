import { describe, expect, it } from 'vitest';
import {
  type FunctionAnswers,
  renderKnowledgeItem,
  validateFunctionAnswers,
} from './agent-function-answers';
import { sdrFixture } from './agent-functions.fixture';

const KEY = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';

const complete: FunctionAnswers = {
  'empresa.nome': 'CRMThink',
  'empresa.descricao': ' Implantação de Bitrix24 ',
  'comum.tom': 'normal',
  'comum.emojis': 'nao',
  'sdr.perguntas': ['Quantos vendedores?', ' '],
  'sdr.cliente_atual': 'transferir',
  'registro.onde': 'conversa',
  'base.produtos': [{ itemKey: KEY, values: { nome: 'Plano Pro', descricao: 'CRM completo' } }],
};

const validate = (answers: FunctionAnswers, partial = false) =>
  validateFunctionAnswers(sdrFixture, answers, { partial });

describe('respostas do formulário', () => {
  it('aceita e normaliza respostas completas', () => {
    const { answers, issues } = validate(complete);
    expect(issues).toEqual([]);
    expect(answers['empresa.descricao']).toBe('Implantação de Bitrix24');
    expect(answers['sdr.perguntas']).toEqual(['Quantos vendedores?']);
  });

  it('exige obrigatórios fora do rascunho', () => {
    const { issues } = validate({ 'empresa.nome': 'X' });
    expect(issues).toContainEqual({ field: 'empresa.descricao', message: 'campo obrigatório' });
    expect(validate({ 'empresa.nome': 'X' }, true).issues).toEqual([]);
  });

  it('mantém os limites no rascunho', () => {
    const { issues } = validate({ 'sdr.perguntas': ['a', 'b', 'c', 'd'] }, true);
    expect(issues).toContainEqual({ field: 'sdr.perguntas', message: 'use no máximo 3 itens' });
  });

  it('limita o tamanho dos textos e dos itens da lista', () => {
    const { issues } = validate({
      ...complete,
      'empresa.nome': 'x'.repeat(101),
      'sdr.perguntas': ['y'.repeat(121)],
    });
    expect(issues).toEqual([
      { field: 'empresa.nome', message: 'use até 100 caracteres' },
      { field: 'sdr.perguntas[0]', message: 'use até 120 caracteres' },
    ]);
  });

  it('exige o dependente só com a opção escolhida', () => {
    expect(validate({ ...complete, 'sdr.cliente_atual': 'canal' }).issues).toEqual([
      { field: 'sdr.canal_suporte', message: 'campo obrigatório' },
    ]);
    const { answers } = validate({ ...complete, 'sdr.canal_suporte': 'WhatsApp' });
    expect(answers['sdr.canal_suporte']).toBeUndefined();
  });

  it('recusa opção inexistente e funil incompleto', () => {
    const { issues } = validate({
      ...complete,
      'comum.tom': 'gritado',
      'registro.onde': 'funil',
      'registro.funil': { categoryId: 2 } as never,
    });
    expect(issues).toEqual([
      { field: 'comum.tom', message: 'escolha uma das opções' },
      { field: 'registro.funil', message: 'escolha o funil e a etapa' },
    ]);
  });

  it('ordena a múltipla escolha pelas opções', () => {
    expect(
      validate({ ...complete, 'sdr.cobre': ['demo', 'preco', 'demo'] }).answers['sdr.cobre'],
    ).toEqual(['preco', 'demo']);
  });

  it('recusa itens da base repetidos', () => {
    const { issues } = validate({
      ...complete,
      'base.produtos': [
        { itemKey: KEY, values: { nome: 'P', descricao: 'z'.repeat(800) } },
        { itemKey: KEY, values: { nome: 'Q', descricao: 'w' } },
      ],
    });
    expect(issues).toContainEqual({ field: 'base.produtos', message: 'itens repetidos' });
  });
});

describe('texto do item da base', () => {
  it('omite a linha cujos subcampos ficaram vazios', () => {
    const field = {
      kind: 'KNOWLEDGE' as const,
      id: 'base.servicos',
      label: 'Serviços',
      required: false,
      maxItems: 5,
      subfields: [
        { id: 'nome', label: 'Nome', required: true, maxLength: 60, multiline: false },
        { id: 'valor', label: 'Valor', required: false, maxLength: 60, multiline: false },
      ],
      format: 'Serviço: {{nome}}\nValor: {{valor}}\nAgende pelo link.',
    };
    const item = { itemKey: KEY, values: { nome: 'Avaliação', valor: ' ' } };
    expect(renderKnowledgeItem(field, item)).toBe('Serviço: Avaliação\nAgende pelo link.');
  });
});
