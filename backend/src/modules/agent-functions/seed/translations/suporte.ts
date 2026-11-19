import type { FunctionTranslations } from '@gptmaker/contracts';

/** Traduções do Suporte (spec function-template-i18n); os campos dos blocos estão em `blocks.ts`. */
export const SUPPORT_TRANSLATIONS: FunctionTranslations = {
  en: {
    name: 'Support',
    description:
      'Solves customer questions and problems using the knowledge base and, when it cannot, transfers or opens a ticket in Bitrix24.',
    fields: {
      'suporte.excluidos': {
        label: 'Topics the agent does not handle',
        help: 'The agent hands these over without trying to solve them.',
        placeholder: 'Cancellations',
        assistQuestions: [
          'Which topics do you prefer a team member to handle?',
          'Name 2 problems that cannot wait until tomorrow',
        ],
      },
      'suporte.identificacao': {
        label: 'Data to identify the customer',
        options: {
          nome: 'Name',
          email: 'Email',
          documento: 'Tax ID',
          pedido: 'Order number',
          contrato: 'Contract number',
          dominio: 'Bitrix24 address',
        },
      },
      'suporte.escalonamento': {
        label: 'When it cannot solve the problem',
        options: {
          transferir: 'Transfer to an agent',
          chamado: 'Open a ticket in Bitrix24',
        },
      },
      'suporte.chamado_onde': {
        label: 'Where to open the ticket',
        options: {
          tarefa: 'Task in Bitrix24',
          negocio: 'Deal in a support pipeline',
        },
      },
      'suporte.responsavel': { label: 'Owner' },
      'suporte.prazo': { label: 'Task deadline (days)' },
      'suporte.funil': { label: 'Pipeline and stage' },
      'suporte.chamado_depois': {
        label: 'After opening the ticket',
        options: {
          retorno: 'Say the team will get back',
          transferir: 'Transfer to an agent',
        },
      },
      'suporte.insatisfeito': {
        label: 'Angry or dissatisfied customer',
        options: {
          transferir: 'Transfer immediately',
          tentar: 'Try to solve it once and offer an agent',
        },
      },
      'suporte.vendas': {
        label: 'Purchase or quote request',
        options: {
          transferir: 'Transfer to an agent',
          canal: 'Share the sales channel',
        },
      },
      'suporte.canal_vendas': { label: 'Sales channel' },
      'base.problemas': {
        label: 'Common problems',
        help: 'The problem as the customer describes it and the step-by-step solution.',
        subfields: { problema: 'Problem', solucao: 'Solution' },
        assistQuestions: [
          'What problems do customers bring to support most often?',
          'How do you solve each one?',
        ],
      },
      'base.faq': {
        label: 'Frequently asked questions',
        subfields: { pergunta: 'Question', resposta: 'Answer' },
        assistQuestions: [
          'What questions do customers ask support most?',
          'How do you answer them?',
        ],
      },
      'base.politicas': {
        label: 'Policies',
        help: 'Exchanges, warranty, deadlines, business hours.',
        subfields: { titulo: 'Title', texto: 'Text' },
        assistQuestions: [
          'What rules does support need to follow, such as refunds, warranty and deadlines?',
          'When does each rule apply?',
        ],
      },
    },
  },
  es: {
    name: 'Soporte',
    description:
      'Resuelve dudas y problemas de clientes con la base de conocimiento y, cuando no puede, transfiere o abre un ticket en Bitrix24.',
    fields: {
      'suporte.excluidos': {
        label: 'Temas que el agente no resuelve',
        help: 'El agente los deriva sin intentar resolverlos.',
        placeholder: 'Cancelaciones',
        assistQuestions: [
          '¿Qué temas prefiere que resuelva una persona del equipo?',
          'Mencione 2 problemas que no pueden esperar hasta mañana',
        ],
      },
      'suporte.identificacao': {
        label: 'Datos para identificar al cliente',
        options: {
          nome: 'Nombre',
          email: 'Correo electrónico',
          documento: 'Documento fiscal',
          pedido: 'Número de pedido',
          contrato: 'Número de contrato',
          dominio: 'Dirección de Bitrix24',
        },
      },
      'suporte.escalonamento': {
        label: 'Cuando no logre resolver',
        options: {
          transferir: 'Transferir a un agente',
          chamado: 'Abrir un ticket en Bitrix24',
        },
      },
      'suporte.chamado_onde': {
        label: 'Dónde abrir el ticket',
        options: {
          tarefa: 'Tarea en Bitrix24',
          negocio: 'Negocio en un embudo de soporte',
        },
      },
      'suporte.responsavel': { label: 'Responsable' },
      'suporte.prazo': { label: 'Plazo de la tarea (días)' },
      'suporte.funil': { label: 'Embudo y etapa' },
      'suporte.chamado_depois': {
        label: 'Después de abrir el ticket',
        options: {
          retorno: 'Avisar que el equipo responderá',
          transferir: 'Transferir a un agente',
        },
      },
      'suporte.insatisfeito': {
        label: 'Cliente molesto o insatisfecho',
        options: {
          transferir: 'Transferir de inmediato',
          tentar: 'Intentar resolver una vez y ofrecer un agente',
        },
      },
      'suporte.vendas': {
        label: 'Pedido de compra o presupuesto',
        options: {
          transferir: 'Transferir a un agente',
          canal: 'Informar el canal de ventas',
        },
      },
      'suporte.canal_vendas': { label: 'Canal de ventas' },
      'base.problemas': {
        label: 'Problemas comunes',
        help: 'El problema como lo describe el cliente y el paso a paso de la solución.',
        subfields: { problema: 'Problema', solucao: 'Solución' },
        assistQuestions: [
          '¿Qué problemas traen los clientes con más frecuencia al soporte?',
          '¿Cómo resuelven cada uno?',
        ],
      },
      'base.faq': {
        label: 'Preguntas frecuentes',
        subfields: { pergunta: 'Pregunta', resposta: 'Respuesta' },
        assistQuestions: ['¿Qué dudas hacen más los clientes al soporte?', '¿Cómo les responden?'],
      },
      'base.politicas': {
        label: 'Políticas',
        help: 'Cambios, garantía, plazos, horarios.',
        subfields: { titulo: 'Título', texto: 'Texto' },
        assistQuestions: [
          '¿Qué reglas debe seguir el soporte, como reembolsos, garantía y plazos?',
          '¿Cuándo se aplica cada regla?',
        ],
      },
    },
  },
};
