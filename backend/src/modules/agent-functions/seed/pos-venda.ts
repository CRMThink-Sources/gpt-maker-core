import type { SeedTemplate } from './types';

/** Pós-venda (reativo): entrega, troca e garantia, avaliação e recompra. */
export const POST_SALES: SeedTemplate = {
  code: 'POST_SALES',
  name: 'Pós-venda',
  description:
    'Atende quem já comprou: entrega e primeiros passos, troca e garantia, avaliação da experiência e ofertas de recompra.',
  draft: {
    agentType: 'SUPPORT',
    settings: { enabledHumanTransfer: true, limitSubjects: true },
    profile: { jobName: '{{empresa.nome}}', jobDescription: '{{empresa.descricao}}' },
    blocks: ['comum', 'registro', 'duvida', 'transferir'],
    fields: [
      {
        kind: 'MULTI_CHOICE',
        id: 'posvenda.escopo',
        label: 'O que o agente cobre',
        required: true,
        separator: '\n\n',
        options: [
          {
            value: 'entrega',
            label: 'Entrega e primeiros passos',
            snippet:
              'ENTREGA E PRIMEIROS PASSOS\nAjude com entrega e primeiros passos usando a base de conhecimento.',
          },
          {
            value: 'troca',
            label: 'Troca, devolução e garantia',
            snippet: 'TROCA, DEVOLUÇÃO E GARANTIA\n{{posvenda.troca}}',
            dependents: [
              {
                kind: 'CHOICE',
                id: 'posvenda.troca',
                label: 'Pedidos de troca, devolução ou garantia',
                required: true,
                options: [
                  {
                    value: 'politicas',
                    label: 'Orientar pelas políticas da base',
                    snippet:
                      'Oriente conforme as políticas da base; caso fora delas, use "Registrar dúvida".',
                  },
                  {
                    value: 'transferir',
                    label: 'Transferir para um atendente',
                    snippet: 'Use "Transferir para atendente".',
                  },
                ],
              },
            ],
          },
          {
            value: 'avaliacao',
            label: 'Coletar avaliação',
            snippet: 'AVALIAÇÃO\n{{posvenda.formato}}',
            dependents: [
              {
                kind: 'CHOICE',
                id: 'posvenda.formato',
                label: 'Formato da avaliação',
                required: true,
                options: [
                  {
                    value: 'nps',
                    label: 'Nota de 0 a 10 e motivo',
                    snippet:
                      'Peça uma nota de 0 a 10 e o motivo. De 0 a 6, use "Registrar avaliação negativa"; de 7 a 10, "Registrar avaliação positiva".',
                  },
                  {
                    value: 'estrelas',
                    label: 'Nota de 1 a 5',
                    snippet:
                      'Peça uma nota de 1 a 5. Notas 1 e 2: use "Registrar avaliação negativa"; de 3 a 5, "Registrar avaliação positiva".',
                  },
                  {
                    value: 'livre',
                    label: 'Comentário livre',
                    snippet:
                      'Peça um comentário sobre a experiência. Reclamação: "Registrar avaliação negativa"; senão, "Registrar avaliação positiva".',
                  },
                ],
              },
              {
                kind: 'CHOICE',
                id: 'posvenda.baixa',
                label: 'Avaliação negativa',
                required: true,
                options: [
                  {
                    value: 'transferir',
                    label: 'Transferir para um atendente',
                    snippet: 'Peça desculpas e avise que um atendente vai continuar.',
                  },
                  {
                    value: 'tarefa',
                    label: 'Registrar e avisar que alguém vai entrar em contato',
                    snippet: 'Peça desculpas e avise que alguém da equipe vai entrar em contato.',
                    dependents: [
                      {
                        kind: 'BITRIX_USER',
                        id: 'posvenda.responsavel',
                        label: 'Responsável',
                        required: true,
                      },
                      {
                        kind: 'INTEGER',
                        id: 'posvenda.prazo',
                        label: 'Prazo da tarefa (dias)',
                        required: true,
                        min: 0,
                        max: 30,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            value: 'recompra',
            label: 'Recompra ou indicação',
            snippet:
              'RECOMPRA E INDICAÇÃO\n{{posvenda.quando}} ofereça: {{posvenda.oferta}}. Nunca insista.',
            dependents: [
              {
                kind: 'TEXT',
                id: 'posvenda.oferta',
                label: 'O que oferecer',
                required: true,
                maxLength: 200,
              },
              {
                kind: 'CHOICE',
                id: 'posvenda.quando',
                label: 'Quando oferecer',
                required: true,
                options: [
                  {
                    value: 'positiva',
                    label: 'Só depois de uma avaliação positiva',
                    snippet: 'Só depois de uma avaliação positiva,',
                  },
                  {
                    value: 'interesse',
                    label: 'Quando o cliente demonstrar interesse',
                    snippet: 'Quando o cliente demonstrar interesse,',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        kind: 'CHOICE',
        id: 'posvenda.tecnico',
        label: 'Problema técnico ou de uso',
        required: true,
        options: [
          {
            value: 'transferir',
            label: 'Transferir para um atendente',
            snippet: 'Problemas técnicos: use "Transferir para atendente".',
          },
          {
            value: 'canal',
            label: 'Informar o canal de suporte',
            snippet: 'Problemas técnicos: oriente a falar pelo {{posvenda.canal_suporte}}.',
            dependents: [
              {
                kind: 'TEXT',
                id: 'posvenda.canal_suporte',
                label: 'Canal de suporte',
                required: true,
                maxLength: 80,
              },
            ],
          },
        ],
      },
      {
        kind: 'KNOWLEDGE',
        id: 'base.politicas',
        label: 'Políticas',
        help: 'Troca, devolução, garantia, prazos de entrega.',
        required: false,
        maxItems: 10,
        subfields: [
          { id: 'titulo', label: 'Título', required: true, maxLength: 100 },
          { id: 'texto', label: 'Texto', required: true, maxLength: 900, multiline: true },
        ],
        format: 'Política: {{titulo}}\n{{texto}}',
      },
      {
        kind: 'KNOWLEDGE',
        id: 'base.primeiros_passos',
        label: 'Primeiros passos',
        help: 'Como ativar, montar, acessar.',
        required: false,
        maxItems: 15,
        subfields: [
          { id: 'titulo', label: 'Título', required: true, maxLength: 100 },
          { id: 'texto', label: 'Passo a passo', required: true, maxLength: 900, multiline: true },
        ],
        format: 'Primeiros passos: {{titulo}}\n{{texto}}',
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
    ],
    behavior: [
      'Você é {{agente.nome}}, do pós-venda da {{empresa.nome}}. {{empresa.descricao}}',
      'Você atende quem já é cliente e cuida da experiência depois da compra. Você não resolve problemas técnicos a fundo.',
      '',
      '{{posvenda.escopo}}',
      '',
      '{{posvenda.tecnico}}',
      '',
      '{{bloco.duvida}}',
      '',
      'ESTILO',
      '{{comum.tom}} {{comum.emojis}} Cordial e breve.',
      '',
      '{{avancado.instrucoes_adicionais}}',
    ].join('\n'),
    intentions: [
      {
        key: 'avaliacao_positiva',
        name: 'Registrar avaliação positiva',
        whenToUse: 'Quando o cliente der uma avaliação positiva da experiência.',
        when: { field: 'posvenda.escopo', in: ['avaliacao'] },
        fields: [
          {
            name: 'Nota',
            description: 'A nota ou o resumo da avaliação.',
            type: 'STRING',
            required: true,
          },
          {
            name: 'Comentário',
            description: 'O que o cliente comentou.',
            type: 'STRING',
            required: false,
          },
        ],
        actions: [
          {
            type: 'TIMELINE_COMMENT',
            config: { text: 'Avaliação positiva: {{fields.nota}}\n{{fields.comentario}}' },
          },
        ],
        responseMode: 'INSTRUCTIONS',
        instructions: 'Agradeça a avaliação.',
      },
      {
        key: 'avaliacao_negativa',
        name: 'Registrar avaliação negativa',
        whenToUse: 'Quando o cliente der uma avaliação negativa ou reclamar da experiência.',
        when: { field: 'posvenda.escopo', in: ['avaliacao'] },
        fields: [
          {
            name: 'Nota',
            description: 'A nota ou o resumo da avaliação.',
            type: 'STRING',
            required: true,
          },
          {
            name: 'Comentário',
            description: 'O que o cliente reclamou.',
            type: 'STRING',
            required: false,
          },
        ],
        actions: [
          {
            type: 'TIMELINE_COMMENT',
            config: { text: 'Avaliação negativa: {{fields.nota}}\n{{fields.comentario}}' },
          },
          {
            when: { field: 'posvenda.baixa', in: ['tarefa'] },
            type: 'CREATE_TASK',
            config: {
              title: 'Avaliação negativa de {{contact.name}}',
              description:
                'Nota: {{fields.nota}}\n{{fields.comentario}}\nTelefone: {{contact.phone}}',
              responsibleId: '{{posvenda.responsavel}}',
              deadlineDays: '{{posvenda.prazo}}',
            },
          },
          {
            when: { field: 'posvenda.baixa', in: ['transferir'] },
            type: 'TRANSFER_TO_HUMAN',
            config: { target: 'OPERATOR' },
          },
        ],
        responseMode: 'INSTRUCTIONS',
        instructions: '{{posvenda.baixa}}',
      },
    ],
  },
};
