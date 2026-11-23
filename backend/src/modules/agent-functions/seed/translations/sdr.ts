import type { FunctionTranslations } from '@gptmaker/contracts';

/** Traduções do SDR (spec function-template-i18n); os campos dos blocos estão em `blocks.ts`. */
export const SDR_TRANSLATIONS: FunctionTranslations = {
  en: {
    name: 'SDR / Qualification',
    description:
      'Serves people who show interest, asks the qualification questions and hands qualified leads over to the sales team.',
    fields: {
      'sdr.perfil_ideal': {
        label: 'Who you sell to',
        help: 'The ideal customer: size, segment, moment.',
        placeholder: 'Companies with a sales team that use or want to use a CRM',
        assistQuestions: [
          'What kind of company usually buys from you?',
          'What company size or stage fits best with what you sell?',
        ],
      },
      'sdr.perguntas': {
        label: 'Qualification questions',
        help: 'The agent asks one at a time, at the pace of the conversation. The answers go to Bitrix24.',
        placeholder: 'How many salespeople are on the team?',
        assistQuestions: [
          'What do you need to know about someone to decide whether a conversation is worth it?',
          'What information usually separates a good customer from one that is not a fit?',
        ],
      },
      'sdr.criterio': {
        label: 'When the lead is qualified',
        placeholder: '5 or more salespeople and intent to implement within 3 months',
        assistQuestions: [
          'What signals make a lead worth a call from you?',
          'If the person answered the questions, what would they have to say for you to want to talk to them?',
        ],
      },
      'sdr.qualificado': {
        label: 'Qualified lead',
        options: {
          transferir: 'Transfer to a consultant',
          registrar: 'Record it and say we will get in touch',
        },
      },
      'sdr.nao_qualificado': {
        label: 'Unqualified lead',
        options: {
          encerrar: 'Thank them and end the conversation politely',
          material: 'Point to a resource',
          transferir: 'Transfer anyway',
        },
      },
      'sdr.material': { label: 'Resource link' },
      'sdr.preco': {
        label: 'Can the agent talk about price?',
        options: {
          nao: 'No, refer to the consultant',
          a_partir: 'Only the "starting at" price',
          base: 'Yes, using the knowledge base',
        },
      },
      'sdr.cliente_atual': {
        label: 'Current customer asking for support',
        options: {
          transferir: 'Transfer to an agent',
          canal: 'Share the support channel',
        },
      },
      'sdr.canal_suporte': {
        label: 'Support channel',
        placeholder: 'WhatsApp (11) 4000-0000',
      },
      'base.produtos': {
        label: 'Products and services',
        subfields: { nome: 'Name', descricao: 'Description' },
        assistQuestions: [
          'What products or services do you sell?',
          'For each one, what does it do and who is it for?',
        ],
      },
      'base.objecoes': {
        label: 'Common objections',
        subfields: { objecao: 'Objection', resposta: 'How to respond' },
        assistQuestions: [
          'What objections do customers usually raise before buying?',
          'How do you answer each one?',
        ],
      },
      'base.faq': {
        label: 'Frequently asked questions',
        subfields: { pergunta: 'Question', resposta: 'Answer' },
        assistQuestions: [
          'What questions do customers ask most before buying?',
          'How do you answer them?',
        ],
      },
    },
  },
  es: {
    name: 'SDR / Calificación',
    description:
      'Atiende a quien llega interesado, hace las preguntas de calificación y deriva los leads calificados al equipo comercial.',
    fields: {
      'sdr.perfil_ideal': {
        label: 'A quién le venden',
        help: 'El cliente ideal: tamaño, segmento, momento.',
        placeholder: 'Empresas con equipo comercial que usan o quieren usar un CRM',
        assistQuestions: [
          '¿Qué tipo de empresa suele comprarles?',
          '¿Qué tamaño o momento de empresa encaja mejor con lo que venden?',
        ],
      },
      'sdr.perguntas': {
        label: 'Preguntas de calificación',
        help: 'El agente hace una por vez, al ritmo de la conversación. Las respuestas van a Bitrix24.',
        placeholder: '¿Cuántos vendedores tiene el equipo?',
        assistQuestions: [
          '¿Qué necesita saber de alguien para decidir si vale una conversación?',
          '¿Qué información suele separar a un buen cliente de uno que no encaja?',
        ],
      },
      'sdr.criterio': {
        label: 'Cuándo el lead está calificado',
        placeholder: '5 vendedores o más e intención de implementar en hasta 3 meses',
        assistQuestions: [
          '¿Qué señales hacen que un lead valga una llamada suya?',
          'Si la persona respondiera las preguntas, ¿qué tendría que decir para que usted quiera hablar con ella?',
        ],
      },
      'sdr.qualificado': {
        label: 'Lead calificado',
        options: {
          transferir: 'Transferir a un consultor',
          registrar: 'Registrar y avisar que nos pondremos en contacto',
        },
      },
      'sdr.nao_qualificado': {
        label: 'Lead no calificado',
        options: {
          encerrar: 'Agradecer y terminar con cordialidad',
          material: 'Indicar un material',
          transferir: 'Transferir de todos modos',
        },
      },
      'sdr.material': { label: 'Enlace del material' },
      'sdr.preco': {
        label: '¿El agente puede hablar de precios?',
        options: {
          nao: 'No, derivar al consultor',
          a_partir: 'Solo el "desde"',
          base: 'Sí, usando la base de conocimiento',
        },
      },
      'sdr.cliente_atual': {
        label: 'Cliente actual que pide soporte',
        options: {
          transferir: 'Transferir a un agente',
          canal: 'Informar el canal de soporte',
        },
      },
      'sdr.canal_suporte': {
        label: 'Canal de soporte',
        placeholder: 'WhatsApp (11) 4000-0000',
      },
      'base.produtos': {
        label: 'Productos y servicios',
        subfields: { nome: 'Nombre', descricao: 'Descripción' },
        assistQuestions: [
          '¿Qué productos o servicios venden?',
          'Para cada uno, ¿qué hace y a quién le sirve?',
        ],
      },
      'base.objecoes': {
        label: 'Objeciones frecuentes',
        subfields: { objecao: 'Objeción', resposta: 'Cómo responder' },
        assistQuestions: [
          '¿Qué objeciones suelen plantear los clientes antes de comprar?',
          '¿Cómo responden a cada una?',
        ],
      },
      'base.faq': {
        label: 'Preguntas frecuentes',
        subfields: { pergunta: 'Pregunta', resposta: 'Respuesta' },
        assistQuestions: [
          '¿Qué preguntas hacen más los clientes antes de comprar?',
          '¿Cómo les responden?',
        ],
      },
    },
  },
};
