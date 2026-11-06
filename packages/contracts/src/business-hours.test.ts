import { describe, expect, it } from 'vitest';
import { type BusinessHours, businessHoursSchema, isWithinBusinessHours } from './business-hours';

const weekdays = [{ start: '09:00', end: '18:00' }];
const hours = (timezone = 'America/Sao_Paulo'): BusinessHours => ({
  timezone,
  days: {
    mon: weekdays,
    tue: weekdays,
    wed: weekdays,
    thu: weekdays,
    fri: weekdays,
    sat: [],
    sun: [],
  },
});

describe('businessHoursSchema', () => {
  it('aceita expediente com intervalos e 24:00 como fim', () => {
    const value = hours();
    value.days.mon = [
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '24:00' },
    ];
    expect(businessHoursSchema.safeParse(value).success).toBe(true);
  });

  it('recusa intervalo invertido', () => {
    const value = hours();
    value.days.mon = [{ start: '18:00', end: '09:00' }];
    expect(businessHoursSchema.safeParse(value).success).toBe(false);
  });

  it('recusa intervalos sobrepostos', () => {
    const value = hours();
    value.days.mon = [
      { start: '09:00', end: '13:00' },
      { start: '12:00', end: '18:00' },
    ];
    expect(businessHoursSchema.safeParse(value).success).toBe(false);
  });

  it('recusa fuso inexistente e início 24:00', () => {
    expect(businessHoursSchema.safeParse(hours('Marte/Olimpo')).success).toBe(false);
    const value = hours();
    value.days.mon = [{ start: '24:00', end: '24:00' }];
    expect(businessHoursSchema.safeParse(value).success).toBe(false);
  });
});

describe('isWithinBusinessHours', () => {
  it('sem horário atende 24h', () => {
    expect(isWithinBusinessHours(null, new Date('2026-11-07T03:00:00Z'))).toBe(true);
  });

  it('dentro e fora no dia útil (quarta 10:30 BRT / sábado)', () => {
    expect(isWithinBusinessHours(hours(), new Date('2026-11-04T13:30:00Z'))).toBe(true);
    expect(isWithinBusinessHours(hours(), new Date('2026-11-07T13:30:00Z'))).toBe(false);
  });

  it('início inclusivo e fim exclusivo', () => {
    expect(isWithinBusinessHours(hours(), new Date('2026-11-04T12:00:00Z'))).toBe(true);
    expect(isWithinBusinessHours(hours(), new Date('2026-11-04T21:00:00Z'))).toBe(false);
  });

  it('usa o fuso do agente (Manaus 17:30 = 18:30 em Brasília)', () => {
    expect(isWithinBusinessHours(hours('America/Manaus'), new Date('2026-11-04T21:30:00Z'))).toBe(
      true,
    );
  });

  it('vira o dia pelo fuso, não pelo UTC', () => {
    // 2026-11-07 01:00 UTC ainda é sexta 22:00 em Brasília: fora do expediente, mas dia útil.
    const value = hours();
    value.days.fri = [{ start: '09:00', end: '24:00' }];
    expect(isWithinBusinessHours(value, new Date('2026-11-07T01:00:00Z'))).toBe(true);
  });
});
