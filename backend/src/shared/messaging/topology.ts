/** Exchanges e filas do RabbitMQ; cada seção acrescenta as suas (design D5/D9). */
export const EXCHANGES = {
  /** Eventos do crmthink-platform (`/platform/events`), roteados pelo `type` do evento. */
  paymentsEvents: 'payments.events',
  /**
   * Mensagens recebidas pelos chatbots (design D5). `x-consistent-hash` pela routing key (chave
   * do diálogo): mensagens do mesmo diálogo caem sempre na mesma partição, processadas em ordem.
   */
  channelInbound: 'channel.inbound',
  /** Mensagens que esgotaram as tentativas (fanout para a DLQ). */
  channelDeadLetter: 'channel.dlx',
  /** Consumo do agente (design D5/D8), roteado pelo tipo: `usage.response` por resposta entregue. */
  usageEvents: 'usage.events',
} as const;

export const QUEUES = {
  installationEvents: 'payments.installation-events',
  /** DLQ de `channel.inbound`: inspeção manual, nunca reprocessada sozinha. */
  channelDeadLetter: 'channel.inbound.dlq',
  /**
   * `usage.response` para o débito (consumidor na tarefa 11.4). Declarada já: sem fila ligada, a
   * exchange descartaria os eventos publicados antes do billing existir.
   */
  usageResponse: 'billing.usage-response',
} as const;

/** Routing keys de `usage.events`. */
export const USAGE_EVENTS = {
  response: 'usage.response',
} as const;

/** Partição `index` de `channel.inbound` (uma fila, um consumidor por partição). */
export function channelInboundQueue(index: number): string {
  return `channel.inbound.${index}`;
}

/**
 * Exchange e fila de espera de uma tentativa (o nome leva o atraso: mudar a configuração cria
 * filas novas em vez de colidir com o TTL das existentes). A fila não tem consumidor; vencido o
 * TTL, a mensagem volta para `channel.inbound` com a routing key original, então cai na mesma
 * partição do diálogo.
 */
export function channelRetryName(delayMs: number): string {
  return `channel.retry.${delayMs}ms`;
}

/** Cabeçalhos das mensagens de `channel.inbound`. */
export const CHANNEL_HEADERS = {
  /** Tentativas já feitas (ausente na primeira entrega). */
  attempt: 'x-attempt',
  lastError: 'x-last-error',
} as const;

/**
 * Canais AMQP com prefetch próprio. `channel.inbound`: uma mensagem por vez em cada partição,
 * para processar o diálogo em ordem (as partições seguem em paralelo).
 */
export const AMQP_CHANNELS = {
  channelInbound: 'channel-inbound',
} as const;
