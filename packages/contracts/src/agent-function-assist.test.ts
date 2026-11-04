import { describe, expect, it } from 'vitest';
import { EXPECTATION_MIN } from './agent-knowledge-review';
import {
  assistInputSchema,
  assistModelOutputSchema,
  assistResultSchema,
} from './agent-function-assist';

const about = 'a'.repeat(EXPECTATION_MIN);
const valid = { fieldIds: ['f1'], about, interview: [], answers: {} };

describe('agent-function-assist', () => {
  it('accepts a valid input', () => {
    expect(assistInputSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects about shorter than EXPECTATION_MIN', () => {
    const r = assistInputSchema.safeParse({ ...valid, about: 'a'.repeat(EXPECTATION_MIN - 1) });
    expect(r.success).toBe(false);
  });

  it('rejects more than 5 answers per field', () => {
    const answers = Array.from({ length: 6 }, () => ({ question: 'q', answer: 'a' }));
    const r = assistInputSchema.safeParse({ ...valid, interview: [{ fieldId: 'f1', answers }] });
    expect(r.success).toBe(false);
  });

  it('result requires applicable per field', () => {
    const r = assistResultSchema.safeParse({
      fields: [{ fieldId: 'f1', value: 'x', markers: 0 }],
      credits: 0,
    });
    expect(r.success).toBe(false);
  });

  it('output accepts rows per field', () => {
    const r = assistModelOutputSchema.safeParse({
      fields: [
        {
          fieldId: 'base.produtos',
          rows: [{ nome: 'Plano', descricao: '[preencher: o que inclui]' }],
        },
      ],
    });
    expect(r.success && r.data.fields[0]?.rows?.[0]?.nome).toBe('Plano');
  });
});
