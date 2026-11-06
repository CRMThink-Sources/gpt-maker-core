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

  it('aceita transferência ligada ou desligada e recusa valor não booleano', () => {
    expect(updateAgentSchema.parse({ outOfHoursTransfer: true }).outOfHoursTransfer).toBe(true);
    expect(updateAgentSchema.parse({ outOfHoursTransfer: false }).outOfHoursTransfer).toBe(false);
    expect(updateAgentSchema.safeParse({ outOfHoursTransfer: 'sim' }).success).toBe(false);
  });
  it('transferência ausente não altera', () => {
    expect('outOfHoursTransfer' in updateAgentSchema.parse({ name: 'Ana' })).toBe(false);
  });
});
