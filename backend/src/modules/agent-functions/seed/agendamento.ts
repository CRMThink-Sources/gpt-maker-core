import type { SeedTemplate } from './types';

/** Agendamento: tira dúvidas do serviço e envia o link da agenda externa (quem confirma é ela). */
export const SCHEDULING: SeedTemplate = {
  code: 'SCHEDULING',
  name: 'Agendamento',
  description:
    'Tira dúvidas sobre os serviços e envia o link de agenda certo. O horário é confirmado pela agenda externa (Calendly, Google Agenda...).',
  draft: {
    agentType: 'SUPPORT',
    settings: { enabledHumanTransfer: true, limitSubjects: true },
    profile: { jobName: '{{empresa.nome}}', jobDescription: '{{empresa.descricao}}' },
    blocks: ['comum', 'registro', 'duvida', 'transferir'],
    fields: [
      {
        kind: 'CHOICE',
        id: 'agenda.links',
        label: 'Links de agenda',
        required: true,
        options: [
          {
            value: 'unico',
            label: 'Um link para todos os serviços',
            snippet: 'Para qualquer serviço, use este link: {{agenda.link_geral}}',
            dependents: [
              {
                kind: 'URL',
                id: 'agenda.link_geral',
                label: 'Link da agenda',
                required: true,
                maxLength: 150,
              },
            ],
          },
          {
            value: 'por_servico',
            label: 'Um link por serviço',
            snippet: 'Use o link do serviço escolhido:\n{{agenda.servicos}}',
            dependents: [
              {
                kind: 'TEXT_LIST',
                id: 'agenda.servicos',
                label: 'Serviço e link',
                help: 'Um por linha, no formato "Serviço: link".',
                required: true,
                minItems: 1,
                maxItems: 6,
                itemMaxLength: 150,
                placeholder: 'Avaliação inicial: https://calendly.com/empresa/avaliacao',
              },
            ],
          },
        ],
      },
      {
        kind: 'MULTI_CHOICE',
        id: 'agenda.coleta',
        label: 'Antes de enviar o link, pedir',
        required: true,
        separator: ', ',
        options: [
          { value: 'nome', label: 'Nome', snippet: 'nome' },
          { value: 'telefone', label: 'Telefone', snippet: 'telefone' },
          { value: 'email', label: 'E-mail', snippet: 'e-mail' },
          { value: 'servico', label: 'Serviço desejado', snippet: 'serviço desejado' },
        ],
      },
      {
        kind: 'CHOICE',
        id: 'agenda.valores',
        label: 'O agente pode informar valores?',
        required: true,
        options: [
          {
            value: 'nao',
            label: 'Não, encaminha ao atendente',
            snippet: 'Não informe valores; se perguntarem, use "Transferir para atendente".',
          },
          {
            value: 'base',
            label: 'Sim, usando a base de conhecimento',
            snippet: 'Informe valores só conforme a base de conhecimento.',
          },
        ],
      },
      {
        kind: 'CHOICE',
        id: 'agenda.remarcar',
        label: 'Remarcar ou cancelar',
        required: true,
        options: [
          {
            value: 'confirmacao',
            label: 'Orientar a usar a confirmação recebida da agenda',
            snippet:
              'Oriente a usar o link de remarcação ou cancelamento da confirmação do agendamento.',
          },
          {
            value: 'transferir',
            label: 'Transferir para um atendente',
            snippet: 'Use "Transferir para atendente".',
          },
          {
            value: 'contato',
            label: 'Informar um contato',
            snippet: 'Oriente a falar pelo {{agenda.contato}}.',
            dependents: [
              {
                kind: 'TEXT',
                id: 'agenda.contato',
                label: 'Contato',
                required: true,
                maxLength: 80,
              },
            ],
          },
        ],
      },
      {
        kind: 'KNOWLEDGE',
        id: 'base.servicos',
        label: 'Serviços',
        required: false,
        maxItems: 15,
        subfields: [
          { id: 'nome', label: 'Nome', required: true, maxLength: 60 },
          { id: 'descricao', label: 'Descrição', required: true, maxLength: 500, multiline: true },
          { id: 'duracao', label: 'Duração', required: false, maxLength: 60 },
          {
            id: 'preparo',
            label: 'Preparo ou requisitos',
            required: false,
            maxLength: 200,
            multiline: true,
          },
          { id: 'valor', label: 'Valor', required: false, maxLength: 60 },
        ],
        format:
          'Serviço: {{nome}}\n{{descricao}}\nDuração: {{duracao}}\nComo se preparar: {{preparo}}\nValor: {{valor}}',
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
        id: 'base.local',
        label: 'Local e atendimento',
        help: 'Endereço, como chegar, se é online ou presencial.',
        required: false,
        maxItems: 5,
        subfields: [
          { id: 'titulo', label: 'Título', required: true, maxLength: 100 },
          { id: 'texto', label: 'Texto', required: true, maxLength: 900, multiline: true },
        ],
        format: '{{titulo}}\n{{texto}}',
      },
    ],
    behavior: [
      'Você é {{agente.nome}}, da {{empresa.nome}}. {{empresa.descricao}}',
      'Sua função é ajudar a pessoa a agendar. Você não confirma horários: quem confirma é a agenda, pelo link.',
      '',
      'COMO CONDUZIR',
      '- Entenda qual serviço a pessoa procura e tire dúvidas pela base de conhecimento.',
      '- Antes de enviar o link, peça: {{agenda.coleta}}.',
      '- Envie o link com a ação "Enviar link de agenda".',
      '',
      'LINKS DE AGENDA (use exatamente estes)',
      '{{agenda.links}}',
      '',
      'VALORES',
      '{{agenda.valores}}',
      '',
      'REMARCAR OU CANCELAR',
      '{{agenda.remarcar}}',
      '',
      '{{bloco.duvida}}',
      '',
      'ESTILO',
      '{{comum.tom}} {{comum.emojis}} Respostas curtas.',
      '',
      '{{avancado.instrucoes_adicionais}}',
    ].join('\n'),
    intentions: [
      {
        key: 'enviar_link',
        name: 'Enviar link de agenda',
        whenToUse:
          'Quando a pessoa quiser agendar e já tiver informado o serviço e os dados pedidos.',
        fields: [
          {
            name: 'Serviço',
            description: 'O serviço que a pessoa quer agendar.',
            type: 'STRING',
            required: true,
          },
          { name: 'Nome', description: 'Nome informado.', type: 'STRING', required: false },
          { name: 'Telefone', description: 'Telefone informado.', type: 'STRING', required: false },
          { name: 'E-mail', description: 'E-mail informado.', type: 'STRING', required: false },
        ],
        actions: [
          {
            when: { field: 'registro.onde', in: ['conversa'] },
            type: 'TIMELINE_COMMENT',
            config: {
              text: 'Link de agenda enviado: {{fields.servico}}\nNome: {{fields.nome}}\nTelefone: {{fields.telefone}}\nE-mail: {{fields.e_mail}}',
            },
          },
          {
            when: { field: 'registro.onde', in: ['funil'] },
            type: 'UPSERT_DEAL',
            config: {
              categoryId: '{{registro.funil.categoryId}}',
              stageId: '{{registro.funil.stageId}}',
              fields: {
                TITLE: 'Agendamento: {{fields.servico}} ({{contact.name}})',
                COMMENTS:
                  'Link de agenda enviado. Telefone: {{fields.telefone}}. E-mail: {{fields.e_mail}}',
              },
            },
          },
        ],
        responseMode: 'INSTRUCTIONS',
        instructions:
          'Envie o link do serviço, exatamente como abaixo, e explique que o horário é confirmado pela agenda.\n{{agenda.links}}',
      },
    ],
  },
};
