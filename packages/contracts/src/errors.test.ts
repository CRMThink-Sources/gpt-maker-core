import { describe, expect, it } from 'vitest';
import { apiErrorSchema } from './errors';

describe('apiErrorSchema', () => {
  it('aceita o envelope de erro', () => {
    const parsed = apiErrorSchema.parse({ error: { code: 'NOT_FOUND', message: 'x' } });
    expect(parsed.error.code).toBe('NOT_FOUND');
  });

  it('recusa corpo sem code', () => {
    expect(apiErrorSchema.safeParse({ error: { message: 'x' } }).success).toBe(false);
  });
});
