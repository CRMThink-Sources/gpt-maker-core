import {
  type FunctionTemplateContent,
  type FunctionTemplateContentInput,
  functionTemplateContentSchema,
} from './agent-functions';

/** Template SDR reduzido para os testes do schema e do compilador. */
export const sdrFixtureInput: FunctionTemplateContentInput = {
  agentType: 'SALE',
  settings: { enabledHumanTransfer: true, limitSubjects: true },
  profile: { jobName: '{{empresa.nome}}', jobDescription: '{{empresa.descricao}}' },
  fields: [
    { kind: 'TEXT', id: 'empresa.nome', label: 'Nome da empresa', required: true, maxLength: 100 },
    {
      kind: 'TEXT',
      id: 'empresa.descricao',
      label: 'O que a empresa faz',
      required: true,
      maxLength: 300,
      multiline: true,
    },
    {
      kind: 'CHOICE',
      id: 'comum.tom',
      label: 'Tom',
      required: true,
      options: [
        {
          value: 'formal',
          label: 'Formal',
          snippet: 'Use linguagem formal.',
          effects: { communicationType: 'FORMAL' },
        },
        {
          value: 'normal',
          label: 'Normal',
          snippet: 'Use linguagem cordial.',
          effects: { communicationType: 'NORMAL' },
        },
      ],
    },
    {
      kind: 'CHOICE',
      id: 'comum.emojis',
      label: 'Usar emojis',
      required: true,
      options: [
        {
          value: 'sim',
          label: 'Sim',
          snippet: 'Pode usar emojis.',
          effects: { settings: { enabledEmoji: true } },
        },
        {
          value: 'nao',
          label: 'Não',
          snippet: 'Não use emojis.',
          effects: { settings: { enabledEmoji: false } },
        },
      ],
    },
    {
      kind: 'TEXT_LIST',
      id: 'sdr.perguntas',
      label: 'Perguntas de qualificação',
      required: true,
      minItems: 1,
      maxItems: 3,
      itemMaxLength: 120,
    },
    {
      kind: 'CHOICE',
      id: 'sdr.cliente_atual',
      label: 'Cliente atual pedindo suporte',
      required: true,
      options: [
        { value: 'transferir', label: 'Transferir', snippet: 'Transfira para um atendente.' },
        {
          value: 'canal',
          label: 'Informar o canal de suporte',
          snippet: 'Oriente a falar pelo {{sdr.canal_suporte}}.',
          dependents: [
            {
              kind: 'TEXT',
              id: 'sdr.canal_suporte',
              label: 'Canal de suporte',
              required: true,
              maxLength: 100,
            },
          ],
        },
      ],
    },
    {
      kind: 'MULTI_CHOICE',
      id: 'sdr.cobre',
      label: 'O que o agente cobre',
      required: false,
      options: [
        { value: 'preco', label: 'Preço', snippet: 'PREÇO\nInforme o valor inicial.' },
        {
          value: 'demo',
          label: 'Demonstração',
          snippet: 'DEMONSTRAÇÃO\nOfereça uma demonstração.',
        },
      ],
    },
    {
      kind: 'CHOICE',
      id: 'registro.onde',
      label: 'Onde registrar',
      required: true,
      options: [
        {
          value: 'conversa',
          label: 'No registro vinculado à conversa',
          snippet: 'Registre no CRM.',
        },
        {
          value: 'funil',
          label: 'Em um negócio de um funil',
          snippet: 'Registre no funil comercial.',
          dependents: [
            { kind: 'BITRIX_STAGE', id: 'registro.funil', label: 'Funil e etapa', required: true },
          ],
        },
      ],
    },
    {
      kind: 'KNOWLEDGE',
      id: 'base.produtos',
      label: 'Produtos',
      required: false,
      maxItems: 5,
      subfields: [
        { id: 'nome', label: 'Nome', required: true, maxLength: 60 },
        { id: 'descricao', label: 'Descrição', required: true, maxLength: 800, multiline: true },
      ],
      format: 'Produto: {{nome}}\n{{descricao}}',
    },
  ],
  behavior: [
    'Você é {{agente.nome}}, da {{empresa.nome}}. {{empresa.descricao}}',
    '',
    'PERGUNTAS',
    '{{sdr.perguntas}}',
    '',
    '{{sdr.cobre}}',
    '',
    'CLIENTES ATUAIS',
    '{{sdr.cliente_atual}}',
    '',
    'REGISTRO',
    '{{registro.onde}}',
    '',
    'ESTILO',
    '{{comum.tom}} {{comum.emojis}}',
    '',
    '{{avancado.instrucoes_adicionais}}',
  ].join('\n'),
  intentions: [
    {
      key: 'qualificacao',
      name: 'Registrar qualificação',
      whenToUse: 'Quando o lead responder às perguntas de qualificação.',
      collectFrom: 'sdr.perguntas',
      actions: [
        {
          when: { field: 'registro.onde', in: ['conversa'] },
          type: 'TIMELINE_COMMENT',
          config: { text: 'Qualificação de {{contact.name}}:\n{{intencao.respostas}}' },
        },
        {
          when: { field: 'registro.onde', in: ['funil'] },
          type: 'UPSERT_DEAL',
          config: {
            categoryId: '{{registro.funil.categoryId}}',
            stageId: '{{registro.funil.stageId}}',
            fields: {
              TITLE: 'Lead qualificado: {{contact.name}}',
              COMMENTS: '{{intencao.respostas}}',
            },
          },
        },
      ],
      instructions: 'Diga que um consultor vai entrar em contato.',
    },
  ],
};

export const sdrFixture: FunctionTemplateContent =
  functionTemplateContentSchema.parse(sdrFixtureInput);
