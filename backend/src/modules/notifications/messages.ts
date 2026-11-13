import { type Locale, toLocale } from '@gptmaker/contracts';

// Reexporta para os consumidores do módulo (o valor do banco é texto livre com CHECK).
export { toLocale };

/**
 * Textos dos avisos (BB-code do Bitrix24) no idioma do tenant (spec notification-i18n). Apontam
 * para a tela "Créditos e plano" pelo nome: o endereço do app dentro do portal não é conhecido
 * pelo backend. Datas seguem o idioma, mas o fuso dos ciclos de crédito continua o de São Paulo.
 */
const APP = '[B]ThinkFlow AI[/B]';
const TIMEZONE = 'America/Sao_Paulo';

function dateTime(locale: Locale, value: Date): string {
  return value.toLocaleString(locale, {
    timeZone: TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function date(locale: Locale, value: Date): string {
  return value.toLocaleDateString(locale, { timeZone: TIMEZONE });
}

function credits(locale: Locale, value: number): string {
  return value.toLocaleString(locale);
}

interface Texts {
  credit80: (input: { percent: number; remaining: string }) => string;
  creditZero: string;
  paymentFailed: (input: { deadline: string | null; link: string | null }) => string;
  periodEnding: (input: { days: number; end: string }) => string;
  modelDowngraded: (input: { agents: string; plural: boolean; model: string }) => string;
  test: string;
}

const TEXTS: Record<Locale, Texts> = {
  'pt-BR': {
    credit80: ({ percent, remaining }) =>
      `${APP}: seus agentes já usaram ${percent}% dos créditos deste ciclo. Restam ${remaining} créditos. Para não interromper o atendimento, contrate créditos adicionais em "Créditos e plano" no app.`,
    creditZero: `${APP}: os créditos acabaram. As novas mensagens estão sendo transferidas para os atendentes até que haja saldo. Contrate um plano ou créditos adicionais em "Créditos e plano" no app.`,
    paymentFailed: ({ deadline, link }) =>
      `${APP}: o pagamento da assinatura não foi aprovado.${
        deadline
          ? ` Regularize até ${deadline}; depois disso, os agentes ficam pausados até o pagamento.`
          : ''
      } Você pode atualizar o cartão em "Créditos e plano" > "Gerenciar pagamento".${
        link ? ` [URL=${link}]Pagar a fatura[/URL].` : ''
      }`,
    periodEnding: ({ days, end }) =>
      `${APP}: a assinatura termina em ${days === 1 ? '1 dia' : `${days} dias`} (${end}). Fale com a CRMThink para renovar e manter os agentes atendendo.`,
    modelDowngraded: ({ agents, plural, model }) =>
      `${APP}: o plano atual não inclui o modelo de IA ${plural ? 'dos agentes' : 'do agente'} ${agents}. ${plural ? 'Eles passaram' : 'Ele passou'} a usar o ${model}. Os modelos disponíveis estão na edição de cada agente.`,
    test: `${APP}: este é um aviso de teste. É assim que você vai receber os alertas de créditos e de pagamento do app.`,
  },
  en: {
    credit80: ({ percent, remaining }) =>
      `${APP}: your agents have used ${percent}% of this cycle's credits. ${remaining} credits left. To avoid interrupting service, buy additional credits under "Credits and plan" in the app.`,
    creditZero: `${APP}: you have run out of credits. New messages are being transferred to human agents until there is a balance. Buy a plan or additional credits under "Credits and plan" in the app.`,
    paymentFailed: ({ deadline, link }) =>
      `${APP}: the subscription payment was not approved.${
        deadline
          ? ` Please resolve it by ${deadline}; after that, agents will be paused until payment is made.`
          : ''
      } You can update your card under "Credits and plan" > "Manage payment".${
        link ? ` [URL=${link}]Pay the invoice[/URL].` : ''
      }`,
    periodEnding: ({ days, end }) =>
      `${APP}: your subscription ends in ${days === 1 ? '1 day' : `${days} days`} (${end}). Contact CRMThink to renew and keep your agents answering.`,
    modelDowngraded: ({ agents, plural, model }) =>
      `${APP}: your current plan does not include the AI model ${plural ? 'of the agents' : 'of the agent'} ${agents}. ${plural ? 'They are' : 'It is'} now using ${model}. Available models are listed when editing each agent.`,
    test: `${APP}: this is a test notice. This is how you will receive the app's credit and payment alerts.`,
  },
  es: {
    credit80: ({ percent, remaining }) =>
      `${APP}: sus agentes ya usaron el ${percent}% de los créditos de este ciclo. Quedan ${remaining} créditos. Para no interrumpir la atención, contrate créditos adicionales en "Créditos y plan" en la app.`,
    creditZero: `${APP}: se acabaron los créditos. Los mensajes nuevos se están transfiriendo a los agentes humanos hasta que haya saldo. Contrate un plan o créditos adicionales en "Créditos y plan" en la app.`,
    paymentFailed: ({ deadline, link }) =>
      `${APP}: no se aprobó el pago de la suscripción.${
        deadline
          ? ` Regularice hasta el ${deadline}; después, los agentes quedarán en pausa hasta que se pague.`
          : ''
      } Puede actualizar la tarjeta en "Créditos y plan" > "Administrar pago".${
        link ? ` [URL=${link}]Pagar la factura[/URL].` : ''
      }`,
    periodEnding: ({ days, end }) =>
      `${APP}: la suscripción termina en ${days === 1 ? '1 día' : `${days} días`} (${end}). Hable con CRMThink para renovar y mantener a los agentes atendiendo.`,
    modelDowngraded: ({ agents, plural, model }) =>
      `${APP}: el plan actual no incluye el modelo de IA ${plural ? 'de los agentes' : 'del agente'} ${agents}. ${plural ? 'Pasaron' : 'Pasó'} a usar ${model}. Los modelos disponibles están en la edición de cada agente.`,
    test: `${APP}: este es un aviso de prueba. Así recibirá las alertas de créditos y de pago de la app.`,
  },
};

export const MESSAGES = {
  credit80: (locale: Locale, input: { consumedPercent: number; remaining: number }) =>
    TEXTS[locale].credit80({
      percent: input.consumedPercent,
      remaining: credits(locale, input.remaining),
    }),

  creditZero: (locale: Locale) => TEXTS[locale].creditZero,

  paymentFailed: (locale: Locale, input: { graceUntil: Date | null; invoiceUrl: string | null }) =>
    TEXTS[locale].paymentFailed({
      deadline: input.graceUntil ? dateTime(locale, input.graceUntil) : null,
      link: input.invoiceUrl,
    }),

  periodEnding: (locale: Locale, input: { daysLeft: number; periodEnd: Date }) =>
    TEXTS[locale].periodEnding({ days: input.daysLeft, end: date(locale, input.periodEnd) }),

  modelDowngraded: (locale: Locale, input: { agents: string[]; model: string }) =>
    TEXTS[locale].modelDowngraded({
      agents: input.agents.join(', '),
      plural: input.agents.length !== 1,
      model: input.model,
    }),

  test: (locale: Locale) => TEXTS[locale].test,
};
