import type { SeedTemplate } from './types';

/** Suporte: resolve pela base; quando não resolve, escala como o cliente escolheu. */
export const SUPPORT: SeedTemplate = {
  code: 'SUPPORT',
  name: 'Suporte',
  description:
    'Resolve dúvidas e problemas de clientes com a base de conhecimento e, quando não consegue, transfere ou abre um chamado no Bitrix24.',
  draft: {
    agentType: 'SUPPORT',
    settings: { enabledHumanTransfer: true, limitSubjects: true },
    profile: { jobName: '{{empresa.nome}}', jobDescription: '{{empresa.descricao}}' },
    blocks: ['comum', 'registro', 'duvida', 'transferir', 'crm'],
    fields: [
      {
        kind: 'TEXT_LIST',
        id: 'suporte.excluidos',
        label: 'Assuntos que o agente não resolve',
        help: 'O agente encaminha sem tentar resolver.',
        required: false,
        minItems: 0,
        maxItems: 5,
        itemMaxLength: 80,
        placeholder: 'Cancelamento',
      },
      {
        kind: 'MULTI_CHOICE',
        id: 'suporte.identificacao',
        label: 'Dados para identificar o cliente',
        required: true,
        separator: ', ',
        options: [
          { value: 'nome', label: 'Nome', snippet: 'nome' },
          { value: 'email', label: 'E-mail', snippet: 'e-mail' },
          { value: 'documento', label: 'CPF ou CNPJ', snippet: 'CPF ou CNPJ' },
          { value: 'pedido', label: 'Número do pedido', snippet: 'número do pedido' },
          { value: 'contrato', label: 'Número do contrato', snippet: 'número do contrato' },
          {
            value: 'dominio',
            label: 'Endereço do Bitrix24',
            snippet: 'endereço do Bitrix24 (ex.: empresa.bitrix24.com.br)',
          },
        ],
      },
      {
        kind: 'CHOICE',
        id: 'suporte.escalonamento',
        label: 'Quando não conseguir resolver',
        required: true,
        options: [
          {
            value: 'transferir',
            label: 'Transferir para um atendente',
            snippet: 'Use a ação "Transferir para atendente".',
          },
          {
            value: 'chamado',
            label: 'Abrir um chamado no Bitrix24',
            snippet:
              'Use a ação "Abrir chamado" com o resumo do problema e os dados do cliente. {{suporte.chamado_depois}}',
            dependents: [
              {
                kind: 'CHOICE',
                id: 'suporte.chamado_onde',
                label: 'Onde abrir o chamado',
                required: true,
                options: [
                  {
                    value: 'tarefa',
                    label: 'Tarefa no Bitrix24',
                    snippet: 'O chamado é uma tarefa.',
                    dependents: [
                      {
                        kind: 'BITRIX_USER',
                        id: 'suporte.responsavel',
                        label: 'Responsável',
                        required: true,
                      },
                      {
                        kind: 'INTEGER',
                        id: 'suporte.prazo',
                        label: 'Prazo da tarefa (dias)',
                        required: true,
                        min: 0,
                        max: 30,
                      },
                    ],
                  },
                  {
                    value: 'negocio',
                    label: 'Negócio num funil de suporte',
                    snippet: 'O chamado é um negócio.',
                    dependents: [
                      {
                        kind: 'BITRIX_STAGE',
                        id: 'suporte.funil',
                        label: 'Funil e etapa',
                        required: true,
                      },
                    ],
                  },
                ],
              },
              {
                kind: 'CHOICE',
                id: 'suporte.chamado_depois',
                label: 'Depois de abrir o chamado',
                required: true,
                options: [
                  {
                    value: 'retorno',
                    label: 'Avisar que a equipe vai retornar',
                    snippet: 'Avise que a equipe vai retornar.',
                  },
                  {
                    value: 'transferir',
                    label: 'Transferir para um atendente',
                    snippet: 'A ação também chama um atendente.',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        kind: 'CHOICE',
        id: 'suporte.insatisfeito',
        label: 'Cliente irritado ou insatisfeito',
        required: true,
        options: [
          {
            value: 'transferir',
            label: 'Transferir imediatamente',
            snippet:
              'Cliente irritado ou insatisfeito: peça desculpas e use "Transferir para atendente".',
          },
          {
            value: 'tentar',
            label: 'Tentar resolver uma vez e oferecer atendente',
            snippet:
              'Cliente irritado ou insatisfeito: reconheça o problema, tente resolver uma vez e ofereça um atendente.',
          },
        ],
      },
      {
        kind: 'CHOICE',
        id: 'suporte.vendas',
        label: 'Pedido de compra ou orçamento',
        required: true,
        options: [
          {
            value: 'transferir',
            label: 'Transferir para um atendente',
            snippet: 'Compras e orçamentos: use "Transferir para atendente".',
          },
          {
            value: 'canal',
            label: 'Informar o canal de vendas',
            snippet: 'Compras e orçamentos: oriente a falar pelo {{suporte.canal_vendas}}.',
            dependents: [
              {
                kind: 'TEXT',
                id: 'suporte.canal_vendas',
                label: 'Canal de vendas',
                required: true,
                maxLength: 80,
              },
            ],
          },
        ],
      },
      {
        kind: 'KNOWLEDGE',
        id: 'base.problemas',
        label: 'Problemas comuns',
        help: 'O problema como o cliente descreve e o passo a passo da solução.',
        required: false,
        maxItems: 20,
        subfields: [
          { id: 'problema', label: 'Problema', required: true, maxLength: 150 },
          { id: 'solucao', label: 'Solução', required: true, maxLength: 850, multiline: true },
        ],
        format: 'Problema: {{problema}}\nSolução: {{solucao}}',
      },
      {
        kind: 'KNOWLEDGE',
        id: 'base.faq',
        label: 'Perguntas frequentes',
        required: false,
        maxItems: 20,
        subfields: [
          { id: 'pergunta', label: 'Pergunta', required: true, maxLength: 200 },
          { id: 'resposta', label: 'Resposta', required: true, maxLength: 800, multiline: true },
        ],
        format: 'Pergunta: {{pergunta}}\nResposta: {{resposta}}',
      },
      {
        kind: 'KNOWLEDGE',
        id: 'base.politicas',
        label: 'Políticas',
        help: 'Troca, garantia, prazos, horários.',
        required: false,
        maxItems: 10,
        subfields: [
          { id: 'titulo', label: 'Título', required: true, maxLength: 100 },
          { id: 'texto', label: 'Texto', required: true, maxLength: 900, multiline: true },
        ],
        format: 'Política: {{titulo}}\n{{texto}}',
      },
    ],
    behavior: [
      'Você é {{agente.nome}}, do suporte da {{empresa.nome}}. {{empresa.descricao}}',
      'Sua função é resolver dúvidas e problemas de clientes. Você não vende e não promete nada que não esteja na base de conhecimento.',
      '',
      '{{bloco.crm}}',
      '',
      'COMO ATENDER',
      '- Entenda o problema antes de responder; peça detalhes se a descrição for vaga.',
      '- Antes de tratar um caso específico, peça: {{suporte.identificacao}}.',
      '- Use os problemas comuns, as perguntas frequentes e as políticas da base.',
      '- Passe a solução em etapas curtas e confirme se funcionou.',
      '',
      'NÃO RESOLVA, ENCAMINHE',
      '{{suporte.excluidos}}',
      '',
      'QUANDO NÃO RESOLVER',
      '{{suporte.escalonamento}}',
      '',
      '{{suporte.insatisfeito}}',
      '{{suporte.vendas}}',
      '',
      '{{bloco.duvida}}',
      '',
      'ESTILO',
      '{{comum.tom}} {{comum.emojis}} Respostas curtas e diretas.',
      '',
      '{{avancado.instrucoes_adicionais}}',
    ].join('\n'),
    intentions: [
      {
        key: 'abrir_chamado',
        name: 'Abrir chamado',
        whenToUse:
          'Quando você não conseguir resolver o problema do cliente pela base de conhecimento.',
        when: { field: 'suporte.escalonamento', in: ['chamado'] },
        fields: [
          {
            name: 'Resumo',
            description: 'O problema e o que já foi tentado, em poucas frases.',
            type: 'STRING',
            required: true,
          },
          {
            name: 'Dados do cliente',
            description: 'Os dados de identificação que o cliente informou.',
            type: 'STRING',
            required: false,
          },
        ],
        actions: [
          {
            when: { field: 'suporte.chamado_onde', in: ['tarefa'] },
            type: 'CREATE_TASK',
            config: {
              title: 'Chamado de {{contact.name}}',
              description:
                '{{fields.resumo}}\nDados: {{fields.dados_do_cliente}}\nTelefone: {{contact.phone}}',
              responsibleId: '{{suporte.responsavel}}',
              deadlineDays: '{{suporte.prazo}}',
            },
          },
          {
            when: { field: 'suporte.chamado_onde', in: ['negocio'] },
            type: 'UPSERT_DEAL',
            config: {
              categoryId: '{{suporte.funil.categoryId}}',
              stageId: '{{suporte.funil.stageId}}',
              fields: {
                TITLE: 'Chamado de {{contact.name}}',
                COMMENTS: '{{fields.resumo}}\nDados: {{fields.dados_do_cliente}}',
              },
            },
          },
          {
            type: 'TIMELINE_COMMENT',
            config: { text: 'Chamado aberto pelo agente: {{fields.resumo}}' },
          },
          {
            when: { field: 'suporte.chamado_depois', in: ['transferir'] },
            type: 'TRANSFER_TO_HUMAN',
            config: { target: 'OPERATOR' },
          },
        ],
        responseMode: 'INSTRUCTIONS',
        instructions: 'Confirme que o chamado foi aberto. {{suporte.chamado_depois}}',
      },
    ],
  },
};
