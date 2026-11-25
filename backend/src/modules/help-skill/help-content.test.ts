import {
  functionTemplateContentSchema,
  type FunctionTemplateContentInput,
} from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { type HelpFunction, renderHelpContent } from './help-content';

const template: FunctionTemplateContentInput = {
  agentType: 'SUPPORT',
  profile: { jobName: 'INTERNO-cargo', jobDescription: 'INTERNO-descricao', jobSite: '' },
  behavior: 'INTERNO-comportamento {{empresa.nome}}',
  fields: [
    {
      kind: 'TEXT',
      id: 'empresa.nome',
      label: 'Nome da empresa',
      help: 'Como o agente se apresenta.\nUse o nome curto.',
      placeholder: 'Padaria Sol',
      required: true,
      maxLength: 80,
      review: { rubric: 'INTERNO-criterio' },
      assist: { questions: ['INTERNO-pergunta'], instructions: 'INTERNO-instrucao' },
    },
    {
      kind: 'CHOICE',
      id: 'suporte.chamado',
      label: 'Abrir chamado?',
      required: false,
      options: [
        {
          value: 'sim',
          label: 'Sim, abrir chamado',
          snippet: 'INTERNO-trecho',
          effects: { settings: {} },
          dependents: [
            {
              kind: 'BITRIX_USER',
              id: 'suporte.responsavel',
              label: 'Responsável pelo chamado',
              required: true,
              multiple: true,
            },
          ],
        },
        { value: 'nao', label: 'Não', snippet: 'INTERNO-trecho-2' },
      ],
    },
    {
      kind: 'KNOWLEDGE',
      id: 'suporte.base',
      label: 'Perguntas frequentes',
      required: false,
      maxItems: 20,
      format: 'INTERNO-formato {{pergunta}}',
      subfields: [
        { id: 'pergunta', label: 'Pergunta do cliente', required: true, maxLength: 200 },
        { id: 'resposta', label: 'Resposta', required: false, maxLength: 500 },
      ],
    },
    {
      kind: 'BITRIX_SPA',
      id: 'suporte.processo',
      label: 'Processo de atendimento',
      required: false,
      values: [
        {
          id: 'urgencia',
          label: 'Urgência',
          help: 'Campo que guarda a urgência.',
          required: true,
          options: ['Alta', 'Baixa'],
        },
      ],
    },
  ],
  intentions: [
    {
      key: 'abrir_chamado',
      name: 'INTERNO-intencao',
      whenToUse: 'INTERNO-quando',
      actions: [{ type: 'COMMENT', config: { text: 'INTERNO-acao' } }],
      instructions: 'INTERNO-instrucoes',
    },
  ],
  transfers: [
    { key: 'humano', agent: '{{suporte.agente}}', instructions: 'INTERNO-transferencia' },
  ],
};

const support: HelpFunction = {
  name: 'Suporte',
  description: 'Tira dúvidas e abre chamados.',
  content: functionTemplateContentSchema.parse(template),
};

function render(functions: HelpFunction[] = [support]): string {
  return renderHelpContent({
    guide: '## Criar o agente\n\nAbra Agentes.',
    functions,
    generatedAt: new Date('2026-11-25T15:30:00Z'),
  });
}

describe('conteúdo de ajuda (spec customer-help-skill)', () => {
  it('traz a data de geração, o guia e a função com sua descrição', () => {
    const markdown = render();
    expect(markdown).toContain('Conteúdo gerado em 25/11/2026');
    expect(markdown).toContain('## Criar o agente');
    expect(markdown).toContain('### Suporte');
    expect(markdown).toContain('Tira dúvidas e abre chamados.');
  });

  it('descreve cada pergunta com obrigatoriedade, limite, ajuda e exemplo numa linha só', () => {
    const markdown = render();
    expect(markdown).toContain('- **Nome da empresa** (obrigatório): texto de até 80 caracteres.');
    expect(markdown).toContain('Ajuda: Como o agente se apresenta. Use o nome curto.');
    expect(markdown).toContain('Exemplo: Padaria Sol');
  });

  it('mostra as opções e os campos que só aparecem com a opção escolhida', () => {
    const markdown = render();
    expect(markdown).toContain('- **Abrir chamado?** (opcional): escolha uma opção.');
    expect(markdown).toContain('  - Opção: Sim, abrir chamado');
    expect(markdown).toContain(
      '    - **Responsável pelo chamado** (obrigatório): um ou mais usuários do Bitrix24.',
    );
    expect(markdown).toContain('  - Opção: Não');
  });

  it('lista os subcampos de cada item da base de conhecimento', () => {
    const markdown = render();
    expect(markdown).toContain(
      '- **Perguntas frequentes** (opcional): base de conhecimento com até 20 itens.',
    );
    expect(markdown).toContain(
      '  - Em cada item: Pergunta do cliente (obrigatório, até 200 caracteres)',
    );
    expect(markdown).toContain('  - Em cada item: Resposta (opcional, até 500 caracteres)');
  });

  it('lista os valores do processo inteligente', () => {
    const markdown = render();
    expect(markdown).toContain('- **Processo de atendimento** (opcional): processo inteligente');
    expect(markdown).toContain(
      '  - Valor: Urgência (obrigatório). Valores possíveis: Alta, Baixa. Ajuda: Campo que guarda a urgência.',
    );
  });

  it('não expõe nada interno do template', () => {
    expect(render()).not.toContain('INTERNO');
  });

  it('sem função publicada, avisa e mantém o guia', () => {
    const markdown = render([]);
    expect(markdown).toContain('## Criar o agente');
    expect(markdown).toContain('Nenhuma função disponível no momento.');
  });
});
