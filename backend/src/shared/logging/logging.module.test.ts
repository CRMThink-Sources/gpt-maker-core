import { describe, expect, it } from 'vitest';
import { redactUrlToken } from './logging.module';

describe('redactUrlToken', () => {
  it('mascara o token da URL e mantém o resto', () => {
    expect(redactUrlToken('/mcp?t=segredo')).toBe('/mcp?t=[redacted]');
    expect(redactUrlToken('/gptmaker/webhooks/onNewMessage?x=1&t=abc&y=2')).toBe(
      '/gptmaker/webhooks/onNewMessage?x=1&t=[redacted]&y=2',
    );
    expect(redactUrlToken('/app/session')).toBe('/app/session');
    expect(redactUrlToken(undefined)).toBeUndefined();
  });

  it('não confunde outros parâmetros terminados em t', () => {
    expect(redactUrlToken('/x?cat=1&t=s')).toBe('/x?cat=1&t=[redacted]');
  });
});
