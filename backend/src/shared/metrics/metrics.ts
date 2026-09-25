import { collectDefaultMetrics, Registry } from 'prom-client';

/** Registro Prometheus único do processo; métricas de domínio se registram nele. */
export const metricsRegistry = new Registry();

let defaultsCollected = false;

export function initMetrics(role: string): void {
  if (defaultsCollected) return;
  metricsRegistry.setDefaultLabels({ app: 'gptmaker-backend', role });
  collectDefaultMetrics({ register: metricsRegistry });
  defaultsCollected = true;
}
