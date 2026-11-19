import type { FunctionTranslations } from '@gptmaker/contracts';

/** Traduções dos blocos compartilhados (spec function-template-i18n), pelo código do bloco. */
export const BLOCK_TRANSLATIONS: Record<string, FunctionTranslations> = {
  comum: {
    en: {
      fields: {
        'empresa.nome': { label: 'Company name' },
        'empresa.descricao': {
          label: 'What the company does',
          help: 'In one or two sentences: what you sell, to whom and where you operate.',
          assistQuestions: [
            'If a customer asked what your company does, what would you say?',
            'Who do you sell to, and in which cities or regions do you operate?',
          ],
        },
        'comum.tom': {
          label: 'Service tone',
          options: { formal: 'Formal', normal: 'Friendly', descontraido: 'Casual' },
        },
        'comum.emojis': {
          label: 'Use emojis',
          options: { sim: 'Yes, in moderation', nao: 'No' },
        },
      },
    },
    es: {
      fields: {
        'empresa.nome': { label: 'Nombre de la empresa' },
        'empresa.descricao': {
          label: 'A qué se dedica la empresa',
          help: 'En una o dos frases: qué vende, a quién y dónde atiende.',
          assistQuestions: [
            'Si un cliente le preguntara a qué se dedica su empresa, ¿qué le diría?',
            '¿A quién le venden y en qué ciudades o regiones atienden?',
          ],
        },
        'comum.tom': {
          label: 'Tono de la atención',
          options: { formal: 'Formal', normal: 'Cordial', descontraido: 'Informal' },
        },
        'comum.emojis': {
          label: 'Usar emojis',
          options: { sim: 'Sí, con moderación', nao: 'No' },
        },
      },
    },
  },
  registro: {
    en: {
      fields: {
        'registro.onde': {
          label: 'Where to record in Bitrix24',
          help: 'Where the information the agent collects is stored.',
          options: {
            conversa: 'On the record linked to the conversation',
            funil: 'On a deal in a pipeline',
          },
        },
        'registro.funil': { label: 'Pipeline and stage' },
      },
    },
    es: {
      fields: {
        'registro.onde': {
          label: 'Dónde registrar en Bitrix24',
          help: 'Dónde se guarda la información que recopila el agente.',
          options: {
            conversa: 'En el registro vinculado a la conversación',
            funil: 'En un negocio de un embudo',
          },
        },
        'registro.funil': { label: 'Embudo y etapa' },
      },
    },
  },
  duvida: {
    en: {
      fields: {
        'duvida.depois': {
          label: 'When the agent does not know the answer',
          options: {
            transferir: 'Record it and transfer to an agent',
            retorno: 'Record it and say the team will get back',
          },
        },
      },
    },
    es: {
      fields: {
        'duvida.depois': {
          label: 'Cuando el agente no sepa responder',
          options: {
            transferir: 'Registrar y transferir a un agente',
            retorno: 'Registrar y avisar que el equipo responderá',
          },
        },
      },
    },
  },
};
