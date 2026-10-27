import type { FunctionBlockContentInput } from '@gptmaker/contracts';

export interface SeedBlock {
  code: string;
  name: string;
  content: FunctionBlockContentInput;
}

/** Dados da empresa, tom e emojis: o começo do formulário de toda função. */
const comum: SeedBlock = {
  code: 'comum',
  name: 'Dados da empresa e estilo',
  content: {
    fields: [
      {
        kind: 'TEXT',
        id: 'empresa.nome',
        label: 'Nome da empresa',
        required: true,
        maxLength: 80,
      },
      {
        kind: 'TEXT',
        id: 'empresa.descricao',
        label: 'O que a empresa faz',
        help: 'Em uma ou duas frases: o que vende, para quem e onde atende.',
        required: true,
        maxLength: 250,
        multiline: true,
      },
      {
        kind: 'CHOICE',
        id: 'comum.tom',
        label: 'Tom do atendimento',
        required: true,
        options: [
          {
            value: 'formal',
            label: 'Formal',
            snippet: 'Use linguagem formal e trate a pessoa por "você".',
            effects: { communicationType: 'FORMAL' },
          },
          {
            value: 'normal',
            label: 'Cordial',
            snippet: 'Use linguagem cordial e simples.',
            effects: { communicationType: 'NORMAL' },
          },
          {
            value: 'descontraido',
            label: 'Descontraído',
            snippet: 'Use linguagem leve e próxima, sem gírias.',
            effects: { communicationType: 'RELAXED' },
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
            label: 'Sim, com moderação',
            snippet: 'Pode usar até um emoji por mensagem.',
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
    ],
  },
};

/** Onde as ações registram no Bitrix24 (comentário no registro da conversa ou negócio no funil). */
const registro: SeedBlock = {
  code: 'registro',
  name: 'Onde registrar no Bitrix24',
  content: {
    fields: [
      {
        kind: 'CHOICE',
        id: 'registro.onde',
        label: 'Onde registrar no Bitrix24',
        help: 'Onde ficam as informações que o agente coleta.',
        required: true,
        options: [
          {
            value: 'conversa',
            label: 'No registro vinculado à conversa',
            snippet: 'Registre no CRM, no registro da conversa.',
          },
          {
            value: 'funil',
            label: 'Em um negócio de um funil',
            snippet: 'Registre em um negócio do funil escolhido.',
            dependents: [
              {
                kind: 'BITRIX_STAGE',
                id: 'registro.funil',
                label: 'Funil e etapa',
                required: true,
              },
            ],
          },
        ],
      },
    ],
  },
};

/** O "não sei" como ação explícita (design D7). */
const duvida: SeedBlock = {
  code: 'duvida',
  name: 'Registrar dúvida',
  content: {
    fields: [
      {
        kind: 'CHOICE',
        id: 'duvida.depois',
        label: 'Quando o agente não souber responder',
        required: true,
        options: [
          {
            value: 'transferir',
            label: 'Registrar e transferir para um atendente',
            snippet: 'Avise que vai chamar um atendente para responder.',
          },
          {
            value: 'retorno',
            label: 'Registrar e avisar que a equipe vai retornar',
            snippet: 'Avise que a equipe vai verificar e retornar pelo mesmo canal.',
          },
        ],
      },
    ],
    behavior:
      'QUANDO NÃO SOUBER\nResponda só com o que está na base de conhecimento. Se a informação não estiver lá, não deduza nem invente: use a ação "Registrar dúvida".',
    intentions: [
      {
        key: 'registrar_duvida',
        name: 'Registrar dúvida',
        whenToUse:
          'Quando o cliente perguntar algo que não está na base de conhecimento, ou quando você não conseguir resolver o problema dele.',
        fields: [
          {
            name: 'Pergunta',
            description: 'A pergunta ou o problema do cliente, com as palavras dele.',
            type: 'STRING',
            required: true,
          },
          {
            name: 'Motivo',
            description: '"sem informação na base" ou "problema não resolvido".',
            type: 'STRING',
            required: true,
          },
        ],
        actions: [
          {
            when: { field: 'registro.onde', in: ['conversa'] },
            type: 'TIMELINE_COMMENT',
            config: {
              text: 'Dúvida que o agente não respondeu ({{fields.motivo}}):\n{{fields.pergunta}}',
            },
          },
          {
            when: { field: 'registro.onde', in: ['funil'] },
            type: 'UPSERT_DEAL',
            config: {
              categoryId: '{{registro.funil.categoryId}}',
              stageId: '{{registro.funil.stageId}}',
              fields: {
                TITLE: 'Dúvida de {{contact.name}}',
                COMMENTS: '{{fields.pergunta}} ({{fields.motivo}})',
              },
            },
          },
          {
            when: { field: 'duvida.depois', in: ['transferir'] },
            type: 'TRANSFER_TO_HUMAN',
            config: { target: 'OPERATOR' },
          },
        ],
        responseMode: 'INSTRUCTIONS',
        instructions: '{{duvida.depois}}',
      },
    ],
  },
};

/** Transferência para um atendente da Linha Aberta. */
const transferir: SeedBlock = {
  code: 'transferir',
  name: 'Transferir para atendente',
  content: {
    intentions: [
      {
        key: 'transferir_atendente',
        name: 'Transferir para atendente',
        whenToUse:
          'Quando o cliente pedir para falar com uma pessoa, ou quando suas instruções mandarem transferir.',
        fields: [
          {
            name: 'Motivo',
            description: 'Por que a conversa vai para um atendente, em uma frase.',
            type: 'STRING',
            required: true,
          },
        ],
        actions: [
          {
            type: 'TIMELINE_COMMENT',
            config: { text: 'Conversa transferida pelo agente: {{fields.motivo}}' },
          },
          { type: 'TRANSFER_TO_HUMAN', config: { target: 'OPERATOR' } },
        ],
        responseMode: 'INSTRUCTIONS',
        instructions: 'Avise que um atendente vai continuar a conversa em instantes.',
      },
    ],
  },
};

/**
 * Consulta do cliente no CRM ao começar a conversa. A ação é a intenção de sistema do acesso ao
 * CRM (spec agent-crm-tools), que a publicação ativa no agente por causa do `crmAccess`.
 */
const crm: SeedBlock = {
  code: 'crm',
  name: 'Consultar cliente no CRM',
  content: {
    behavior:
      'CLIENTE NO CRM\nNa primeira mensagem da conversa, antes de responder, use a ação "Consultar cliente no CRM". Se o cliente for identificado, chame-o pelo nome, considere os negócios em andamento e não peça dados que já estão no CRM. Se não for identificado, siga normalmente. Não mostre dados internos (responsável, etapa, valor) se o cliente não perguntar.',
    crmAccess: true,
  },
};

export const SEED_BLOCKS: readonly SeedBlock[] = [comum, registro, duvida, transferir, crm];
