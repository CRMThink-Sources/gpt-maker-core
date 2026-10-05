/** Fuso em que se decide se o fim da carência cai no fim de semana. */
export const GRACE_TIMEZONE = 'America/Sao_Paulo';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const weekday = new Intl.DateTimeFormat('en-US', { timeZone: GRACE_TIMEZONE, weekday: 'short' });

/**
 * Fim da carência de pagamento (spec payments-integration): 24 h depois da falha; se esse
 * instante cair no sábado ou no domingo (horário de Brasília), passa para segunda no mesmo
 * horário. Ex.: falha sex 10:00 ⇒ seg 10:00; sáb 09:00 ⇒ seg 09:00; dom 20:00 ⇒ seg 20:00.
 * O Brasil não tem horário de verão desde 2019, então somar dias em milissegundos mantém a hora.
 */
export function graceDeadline(failedAt: Date): Date {
  const deadline = new Date(failedAt.getTime() + DAY_MS);
  const day = weekday.format(deadline);
  if (day === 'Sat') return new Date(deadline.getTime() + 2 * DAY_MS);
  if (day === 'Sun') return new Date(deadline.getTime() + DAY_MS);
  return deadline;
}
