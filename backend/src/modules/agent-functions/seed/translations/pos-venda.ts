import type { FunctionTranslations } from '@gptmaker/contracts';

/** Traduções do Pós-venda (spec function-template-i18n); os campos dos blocos estão em `blocks.ts`. */
export const POST_SALES_TRANSLATIONS: FunctionTranslations = {
  en: {
    name: 'After-sales',
    description:
      'Serves people who have already bought: delivery and first steps, exchanges and warranty, experience feedback and repurchase offers.',
    fields: {
      'posvenda.escopo': {
        label: 'What the agent covers',
        options: {
          entrega: 'Delivery and first steps',
          troca: 'Exchanges, returns and warranty',
          avaliacao: 'Collect feedback',
          recompra: 'Repurchase or referral',
        },
      },
      'posvenda.troca': {
        label: 'Exchange, return or warranty requests',
        options: {
          politicas: 'Guide them using the policies in the knowledge base',
          transferir: 'Transfer to an agent',
        },
      },
      'posvenda.formato': {
        label: 'Feedback format',
        options: {
          nps: 'Score from 0 to 10 and reason',
          estrelas: 'Score from 1 to 5',
          livre: 'Free comment',
        },
      },
      'posvenda.baixa': {
        label: 'Negative feedback',
        options: {
          transferir: 'Transfer to an agent',
          tarefa: 'Record it and say someone will get in touch',
        },
      },
      'posvenda.responsavel': { label: 'Owner' },
      'posvenda.prazo': { label: 'Task deadline (days)' },
      'posvenda.oferta': {
        label: 'What to offer',
        assistQuestions: [
          'What would you like the customer to buy again or recommend?',
          'Is there any benefit for those who come back or refer a friend?',
        ],
      },
      'posvenda.quando': {
        label: 'When to offer it',
        options: {
          positiva: 'Only after positive feedback',
          interesse: 'When the customer shows interest',
        },
      },
      'posvenda.tecnico': {
        label: 'Technical or usage problem',
        options: {
          transferir: 'Transfer to an agent',
          canal: 'Share the support channel',
        },
      },
      'posvenda.canal_suporte': { label: 'Support channel' },
      'base.politicas': {
        label: 'Policies',
        help: 'Exchanges, returns, warranty, delivery times.',
        subfields: { titulo: 'Title', texto: 'Text' },
        assistQuestions: [
          'What rules apply after the purchase, such as exchanges, warranty and returns?',
          'What are the deadlines and conditions for each one?',
        ],
      },
      'base.primeiros_passos': {
        label: 'First steps',
        help: 'How to activate, assemble, sign in.',
        subfields: { titulo: 'Title', texto: 'Step by step' },
        assistQuestions: [
          'What does the customer need to do right after buying?',
          'In what order?',
        ],
      },
      'base.faq': {
        label: 'Frequently asked questions',
        subfields: { pergunta: 'Question', resposta: 'Answer' },
        assistQuestions: [
          'What questions do customers have after the purchase?',
          'How do you answer them?',
        ],
      },
    },
  },
  es: {
    name: 'Posventa',
    description:
      'Atiende a quien ya compró: entrega y primeros pasos, cambios y garantía, evaluación de la experiencia y ofertas de recompra.',
    fields: {
      'posvenda.escopo': {
        label: 'Qué cubre el agente',
        options: {
          entrega: 'Entrega y primeros pasos',
          troca: 'Cambios, devoluciones y garantía',
          avaliacao: 'Recopilar evaluación',
          recompra: 'Recompra o recomendación',
        },
      },
      'posvenda.troca': {
        label: 'Pedidos de cambio, devolución o garantía',
        options: {
          politicas: 'Orientar según las políticas de la base',
          transferir: 'Transferir a un agente',
        },
      },
      'posvenda.formato': {
        label: 'Formato de la evaluación',
        options: {
          nps: 'Nota de 0 a 10 y motivo',
          estrelas: 'Nota de 1 a 5',
          livre: 'Comentario libre',
        },
      },
      'posvenda.baixa': {
        label: 'Evaluación negativa',
        options: {
          transferir: 'Transferir a un agente',
          tarefa: 'Registrar y avisar que alguien se pondrá en contacto',
        },
      },
      'posvenda.responsavel': { label: 'Responsable' },
      'posvenda.prazo': { label: 'Plazo de la tarea (días)' },
      'posvenda.oferta': {
        label: 'Qué ofrecer',
        assistQuestions: [
          '¿Qué le gustaría que el cliente volviera a comprar o recomendara?',
          '¿Hay algún beneficio para quien vuelve o recomienda a un amigo?',
        ],
      },
      'posvenda.quando': {
        label: 'Cuándo ofrecer',
        options: {
          positiva: 'Solo después de una evaluación positiva',
          interesse: 'Cuando el cliente muestre interés',
        },
      },
      'posvenda.tecnico': {
        label: 'Problema técnico o de uso',
        options: {
          transferir: 'Transferir a un agente',
          canal: 'Informar el canal de soporte',
        },
      },
      'posvenda.canal_suporte': { label: 'Canal de soporte' },
      'base.politicas': {
        label: 'Políticas',
        help: 'Cambios, devoluciones, garantía, plazos de entrega.',
        subfields: { titulo: 'Título', texto: 'Texto' },
        assistQuestions: [
          '¿Qué reglas valen después de la compra, como cambio, garantía y devolución?',
          '¿Cuáles son los plazos y las condiciones de cada una?',
        ],
      },
      'base.primeiros_passos': {
        label: 'Primeros pasos',
        help: 'Cómo activar, armar, acceder.',
        subfields: { titulo: 'Título', texto: 'Paso a paso' },
        assistQuestions: [
          '¿Qué necesita hacer el cliente justo después de comprar?',
          '¿En qué orden?',
        ],
      },
      'base.faq': {
        label: 'Preguntas frecuentes',
        subfields: { pergunta: 'Pregunta', resposta: 'Respuesta' },
        assistQuestions: [
          '¿Qué dudas tienen los clientes después de la compra?',
          '¿Cómo les responden?',
        ],
      },
    },
  },
};
