import type { FunctionTranslations } from '@gptmaker/contracts';

/** Traduções do Agendamento (spec function-template-i18n); os campos dos blocos estão em `blocks.ts`. */
export const SCHEDULING_TRANSLATIONS: FunctionTranslations = {
  en: {
    name: 'Scheduling',
    description:
      'Answers questions about the services and sends the right scheduling link. The time is confirmed by the external calendar (Calendly, Google Calendar...).',
    fields: {
      'agenda.links': {
        label: 'Scheduling links',
        options: {
          unico: 'One link for all services',
          por_servico: 'One link per service',
        },
      },
      'agenda.link_geral': { label: 'Scheduling link' },
      'agenda.servicos': {
        label: 'Service and link',
        help: 'One per line, in the format "Service: link".',
        placeholder: 'Initial assessment: https://calendly.com/company/assessment',
      },
      'agenda.coleta': {
        label: 'Before sending the link, ask for',
        options: {
          nome: 'Name',
          telefone: 'Phone',
          email: 'Email',
          servico: 'Desired service',
        },
      },
      'agenda.valores': {
        label: 'Can the agent share prices?',
        options: {
          nao: 'No, refer to an agent',
          base: 'Yes, using the knowledge base',
        },
      },
      'agenda.remarcar': {
        label: 'Reschedule or cancel',
        options: {
          confirmacao: 'Guide them to use the confirmation received from the calendar',
          transferir: 'Transfer to an agent',
          contato: 'Share a contact',
        },
      },
      'agenda.contato': { label: 'Contact' },
      'base.servicos': {
        label: 'Services',
        subfields: {
          nome: 'Name',
          descricao: 'Description',
          duracao: 'Duration',
          preparo: 'Preparation or requirements',
          valor: 'Price',
        },
        assistQuestions: ['What services can customers book?', 'What does each service include?'],
      },
      'base.faq': {
        label: 'Frequently asked questions',
        subfields: { pergunta: 'Question', resposta: 'Answer' },
        assistQuestions: [
          'What questions do customers have before booking?',
          'How do you answer them?',
        ],
      },
      'base.local': {
        label: 'Location and service',
        help: 'Address, directions, whether it is online or in person.',
        subfields: { titulo: 'Title', texto: 'Text' },
        assistQuestions: [
          'Where do you serve customers and how do they get there?',
          'Is there any guidance for the day of the appointment?',
        ],
      },
    },
  },
  es: {
    name: 'Agendamiento',
    description:
      'Resuelve dudas sobre los servicios y envía el enlace de agenda correcto. El horario lo confirma la agenda externa (Calendly, Google Calendar...).',
    fields: {
      'agenda.links': {
        label: 'Enlaces de agenda',
        options: {
          unico: 'Un enlace para todos los servicios',
          por_servico: 'Un enlace por servicio',
        },
      },
      'agenda.link_geral': { label: 'Enlace de la agenda' },
      'agenda.servicos': {
        label: 'Servicio y enlace',
        help: 'Uno por línea, en el formato "Servicio: enlace".',
        placeholder: 'Evaluación inicial: https://calendly.com/empresa/evaluacion',
      },
      'agenda.coleta': {
        label: 'Antes de enviar el enlace, pedir',
        options: {
          nome: 'Nombre',
          telefone: 'Teléfono',
          email: 'Correo electrónico',
          servico: 'Servicio deseado',
        },
      },
      'agenda.valores': {
        label: '¿El agente puede informar precios?',
        options: {
          nao: 'No, derivar a un agente',
          base: 'Sí, usando la base de conocimiento',
        },
      },
      'agenda.remarcar': {
        label: 'Reprogramar o cancelar',
        options: {
          confirmacao: 'Orientar a usar la confirmación recibida de la agenda',
          transferir: 'Transferir a un agente',
          contato: 'Informar un contacto',
        },
      },
      'agenda.contato': { label: 'Contacto' },
      'base.servicos': {
        label: 'Servicios',
        subfields: {
          nome: 'Nombre',
          descricao: 'Descripción',
          duracao: 'Duración',
          preparo: 'Preparación o requisitos',
          valor: 'Precio',
        },
        assistQuestions: [
          '¿Qué servicios pueden agendar los clientes?',
          '¿Qué incluye cada servicio?',
        ],
      },
      'base.faq': {
        label: 'Preguntas frecuentes',
        subfields: { pergunta: 'Pregunta', resposta: 'Respuesta' },
        assistQuestions: [
          '¿Qué dudas tienen los clientes antes de agendar?',
          '¿Cómo les responden?',
        ],
      },
      'base.local': {
        label: 'Lugar y atención',
        help: 'Dirección, cómo llegar, si es en línea o presencial.',
        subfields: { titulo: 'Título', texto: 'Texto' },
        assistQuestions: [
          '¿Dónde atienden y cómo llega el cliente?',
          '¿Hay alguna indicación para el día de la atención?',
        ],
      },
    },
  },
};
