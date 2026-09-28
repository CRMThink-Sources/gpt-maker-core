/** Exchanges e filas do RabbitMQ; cada seção acrescenta as suas (design D5/D9). */
export const EXCHANGES = {
  /** Eventos do crmthink-platform (`/platform/events`), roteados pelo `type` do evento. */
  paymentsEvents: 'payments.events',
} as const;

export const QUEUES = {
  installationEvents: 'payments.installation-events',
} as const;
