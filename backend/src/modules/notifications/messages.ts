/**
 * Textos dos avisos (BB-code do Bitrix24, pt-BR). Apontam para a tela "Créditos e plano" pelo
 * nome: o endereço do app dentro do portal não é conhecido pelo backend.
 */
const APP = '[B]ThinkFlow AI[/B]';
const TIMEZONE = 'America/Sao_Paulo';

function dateTime(date: Date): string {
  return date.toLocaleString('pt-BR', {
    timeZone: TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function date(date: Date): string {
  return date.toLocaleDateString('pt-BR', { timeZone: TIMEZONE });
}

function credits(value: number): string {
  return value.toLocaleString('pt-BR');
}

export const MESSAGES = {
  credit80: (input: { consumedPercent: number; remaining: number }) =>
    `${APP}: seus agentes já usaram ${input.consumedPercent}% dos créditos deste ciclo. Restam ${credits(input.remaining)} créditos. Para não interromper o atendimento, contrate créditos adicionais em "Créditos e plano" no app.`,

  creditZero: () =>
    `${APP}: os créditos acabaram. As novas mensagens estão sendo transferidas para os atendentes até que haja saldo. Contrate um plano ou créditos adicionais em "Créditos e plano" no app.`,

  paymentFailed: (input: { graceUntil: Date | null; invoiceUrl: string | null }) => {
    const deadline = input.graceUntil
      ? ` Regularize até ${dateTime(input.graceUntil)}; depois disso, os agentes ficam pausados até o pagamento.`
      : '';
    const link = input.invoiceUrl ? ` [URL=${input.invoiceUrl}]Pagar a fatura[/URL].` : '';
    return `${APP}: o pagamento da assinatura não foi aprovado.${deadline} Você pode atualizar o cartão em "Créditos e plano" > "Gerenciar pagamento".${link}`;
  },

  periodEnding: (input: { daysLeft: number; periodEnd: Date }) =>
    `${APP}: a assinatura termina em ${input.daysLeft === 1 ? '1 dia' : `${input.daysLeft} dias`} (${date(input.periodEnd)}). Fale com a CRMThink para renovar e manter os agentes atendendo.`,

  modelDowngraded: (input: { agents: string[]; model: string }) =>
    `${APP}: o plano atual não inclui o modelo de IA ${input.agents.length === 1 ? 'do agente' : 'dos agentes'} ${input.agents.join(', ')}. ${input.agents.length === 1 ? 'Ele passou' : 'Eles passaram'} a usar o ${input.model}. Os modelos disponíveis estão na edição de cada agente.`,
};
