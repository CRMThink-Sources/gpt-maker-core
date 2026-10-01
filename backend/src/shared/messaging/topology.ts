/** Exchanges e filas do RabbitMQ; cada seção acrescenta as suas (design D5/D9). */
export const EXCHANGES = {
  /** Eventos do crmthink-platform (`/platform/events`), roteados pelo `type` do evento. */
  paymentsEvents: 'payments.events',
  /**
   * Mensagens recebidas pelos chatbots (design D5). `x-consistent-hash` pela chave do diálogo:
   * mensagens do mesmo diálogo caem sempre na mesma partição, processadas em ordem.
   */
  channelInbound: 'channel.inbound',
} as const;

export const QUEUES = {
  installationEvents: 'payments.installation-events',
} as const;

/** Partição `index` de `channel.inbound` (uma fila, um consumidor por partição). */
export function channelInboundQueue(index: number): string {
  return `channel.inbound.${index}`;
}
