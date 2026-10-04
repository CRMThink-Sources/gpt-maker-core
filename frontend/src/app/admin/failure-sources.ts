import type { FailureSource } from '@gptmaker/contracts';

/** Rótulos das fontes de falha (página Erros e erros do portal; 15.7). */
export const FAILURE_SOURCES: Record<FailureSource, string> = {
  message: 'Mensagens',
  trigger: 'Gatilhos',
  training: 'Treinamentos',
  platform_event: 'Eventos da plataforma',
  platform_outbox: 'Envios à plataforma',
  notification: 'Avisos',
};
