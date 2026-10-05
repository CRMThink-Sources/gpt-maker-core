import { describe, expect, it } from 'vitest';
import { graceDeadline } from './grace-period';

/** Horário de Brasília (UTC-3) ⇒ instante. */
const brt = (local: string) => new Date(`${local}-03:00`);

// Outubro de 2026: dia 1 é quinta, 2 sexta, 3 sábado, 4 domingo, 5 segunda.
describe('graceDeadline (1 dia, fim de semana empurra para segunda)', () => {
  it.each([
    ['qui 15:00 ⇒ sex 15:00', '2026-10-01T15:00:00', '2026-10-02T15:00:00'],
    ['sex 10:00 ⇒ seg 10:00 (sábado pulado)', '2026-10-02T10:00:00', '2026-10-05T10:00:00'],
    ['sáb 09:00 ⇒ seg 09:00 (domingo pulado)', '2026-10-03T09:00:00', '2026-10-05T09:00:00'],
    ['dom 20:00 ⇒ seg 20:00', '2026-10-04T20:00:00', '2026-10-05T20:00:00'],
    ['seg 08:00 ⇒ ter 08:00', '2026-10-05T08:00:00', '2026-10-06T08:00:00'],
    // 23:30 de sexta em Brasília já é sábado em UTC: vale o dia no Brasil.
    ['sex 23:30 ⇒ seg 23:30', '2026-10-02T23:30:00', '2026-10-05T23:30:00'],
    // 22:00 de quinta em Brasília é sexta 01:00 UTC: o fim (sex 22:00) não é fim de semana.
    ['qui 22:00 ⇒ sex 22:00', '2026-10-01T22:00:00', '2026-10-02T22:00:00'],
  ])('%s', (_label, failedAt, expected) => {
    expect(graceDeadline(brt(failedAt))).toEqual(brt(expected));
  });
});
