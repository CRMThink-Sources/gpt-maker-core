import { describe, expect, it } from 'vitest';
import { updateAgentSchema } from './agents';

const hours = {
  timezone: 'America/Sao_Paulo',
  days: {
    mon: [{ start: '09:00', end: '18:00' }],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  },
};

describe('updateAgentSchema (horário de funcionamento)', () => {
  it('aceita horário e mensagem', () => {
    expect(
      updateAgentSchema.safeParse({ businessHours: hours, outOfHoursMessage: 'Voltamos às 9h' })
        .success,
    ).toBe(true);
  });
  it('null remove', () => {
    const r = updateAgentSchema.parse({ businessHours: null, outOfHoursMessage: null });
    expect(r.businessHours).toBeNull();
    expect(r.outOfHoursMessage).toBeNull();
  });
  it('campo ausente não altera', () => {
    const r = updateAgentSchema.parse({ name: 'Ana' });
    expect('businessHours' in r).toBe(false);
  });
  it('recusa horário inválido e mensagem longa', () => {
    expect(
      updateAgentSchema.safeParse({ businessHours: { ...hours, timezone: 'x/y' } }).success,
    ).toBe(false);
    expect(updateAgentSchema.safeParse({ outOfHoursMessage: 'a'.repeat(1001) }).success).toBe(
      false,
    );
  });
});
